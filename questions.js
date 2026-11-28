/* Admin asks the reporter for more information on a report. The question and the reply (text, optional photo) stay on
   the report as a thread, so whoever picks it up next can see why it stalled. Reporters see what needs their reply. */
const QN = { open: 0, byReport: new Map() };
window.QN = QN;
async function loadQuestions() {
  if (!me) return;
  const { data, error } = await sb.from('report_questions').select('id,report_id,reports!inner(user_id)').is('answered_at', null).eq('reports.user_id', me.id);
  if (error) return;
  QN.byReport = new Map(); (data || []).forEach(q => QN.byReport.set(q.report_id, (QN.byReport.get(q.report_id) || 0) + 1));
  const was = QN.open; QN.open = QN.byReport.size;
  const b = $('#qcnt'); if (b) { b.textContent = QN.open; b.hidden = !QN.open; }
  if (QN.open && QN.open > was && !QN.told) { QN.told = true; toast(`Your admin asked about ${QN.open} report${QN.open === 1 ? '' : 's'}. Open My reports to reply.`, 4500); }
  if ($('#scrHome').classList.contains('on') && window.renderHome) renderHome();
}
window.loadQuestions = loadQuestions;

const qWhen = t => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
async function qPhotoUrls(list) {
  const paths = list.map(q => q.answer_photo).filter(Boolean); if (!paths.length) return {};
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  return Object.fromEntries((data || []).map((d, i) => [paths[i], d.signedUrl]));
}
function qHtml(list, urls, canReply) {
  return list.map(q => `<div class="q-item ${q.answered_at ? 'done' : 'open'}">
    <div class="q-ask"><span class="muted small">Admin asked · ${qWhen(q.asked_at)}</span><div>${esc(q.question)}</div></div>
    ${q.answered_at ? `<div class="q-ans"><span class="muted small">Reply · ${qWhen(q.answered_at)}</span>${q.answer ? `<div>${esc(q.answer)}</div>` : ''}${q.answer_photo && urls[q.answer_photo] ? `<a href="${esc(urls[q.answer_photo])}" target="_blank" rel="noopener"><img src="${esc(urls[q.answer_photo])}" alt=""></a>` : ''}</div>`
      : canReply ? `<div class="q-reply" data-q="${q.id}"><textarea rows="3" maxlength="1000" placeholder="Your reply"></textarea>
          <div class="row"><label class="cta static ghost q-ph"><input type="file" accept="image/*" capture="environment" hidden><span>Add photo</span></label><button class="cta static q-send">Send reply</button></div><div class="err"></div></div>`
      : '<div class="muted small q-wait">Waiting for the reporter</div>'}
  </div>`).join('');
}

// reporter: thread on their report, with a reply box for open questions
async function qThread(reportId, el) {
  if (!el) return;
  const { data } = await sb.from('report_questions').select('*').eq('report_id', reportId).order('asked_at');
  if (!data || !data.length) { el.innerHTML = ''; return; }
  const urls = await qPhotoUrls(data);
  el.innerHTML = `<h3>Questions from your admin</h3>${qHtml(data, urls, true)}`;
  el.querySelectorAll('.q-reply').forEach(box => {
    let photo = null;
    const inp = box.querySelector('input[type=file]'), lab = box.querySelector('.q-ph span');
    inp.onchange = async () => { try { photo = await shrink(inp.files[0]); lab.textContent = 'Photo added ✓'; } catch (e) { toast(e.message); } };
    box.querySelector('.q-send').onclick = async () => {
      const text = box.querySelector('textarea').value.trim(), err = box.querySelector('.err'), qid = +box.dataset.q;
      if (!text && !photo) { err.textContent = 'Write a reply or add a photo.'; return; }
      if (HAS_LINK.test(text)) { err.textContent = 'Links are not allowed. Describe it in words.'; return; }
      box.querySelector('.q-send').disabled = true;
      try {
        let path = null;
        if (photo) { path = `${me.id}/${reportId}-q${qid}.jpg`; const { error } = await sb.storage.from('photos').upload(path, dataUrlToBlob(photo), { contentType: 'image/jpeg', upsert: true }); if (error) throw error; }
        const { error } = await sb.rpc('answer_question', { p_id: qid, p_answer: text || null, p_photo: path }); if (error) throw error;
        toast('Reply sent'); loadQuestions(); qThread(reportId, el);
      } catch (e) { err.textContent = e.message || 'Could not send. Check your internet.'; box.querySelector('.q-send').disabled = false; }
    };
  });
}
window.qThread = qThread;

// admin: thread on the review screen, plus an "Ask the reporter" action
async function qAdmin(r) {
  const host = $('#rev'); if (!host) return;
  let el = $('#revQ'); if (!el) { el = document.createElement('div'); el.id = 'revQ'; const acts = $('#acts'); acts.parentNode.insertBefore(el, acts.nextSibling); }
  const { data } = await sb.from('report_questions').select('*').eq('report_id', r.id).order('asked_at');
  const list = data || [], urls = await qPhotoUrls(list), open = list.some(q => !q.answered_at);
  el.innerHTML = (list.length ? `<h3>Questions to the reporter</h3>${qHtml(list, urls, false)}` : '')
    + `<button class="cta static ghost" id="qAsk">${open ? 'Ask another question' : 'Ask the reporter for more info'}</button>`;
  $('#qAsk').onclick = async () => {
    const f = await form('Ask the reporter', [{ key: 'q', label: 'What do you need? (the reporter sees this)', type: 'area', required: true, hint: 'A wider photo showing the street name / how long has it been like this?' }], 'Send');
    if (!f) return;
    const { error } = await sb.from('report_questions').insert({ report_id: r.id, question: f.q.trim() });
    if (error) return toast(error.message);
    toast('Sent. The reporter sees it next time they open the app.'); qAdmin(r);
  };
}
window.qAdmin = qAdmin;
