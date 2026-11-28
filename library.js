/* Law library: every central Act in force (Legislative Department list), the Constitution, and full section text where we
   have it. Separate from bugs for now; later a bug can cite a section. */
const LAW = { list: null, cat: 'all', q: '', deep: false, act: null, secs: [], secQ: '' };
const LAW_CATS = ['Constitution', 'Citizen rights and transparency', 'Criminal law and police', 'Land, housing and local bodies', 'Transport and roads',
  'Electricity, energy and utilities', 'Environment and resources', 'Health and food safety', 'Family, women, children and welfare', 'Labour and employment',
  'Courts, contracts and property', 'Money, tax and business', 'Education and institutions', 'Defence and security forces', 'States and territories', 'Other'];
const lawNorm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function loadLaws() {
  if (LAW.list) return LAW.list;
  const out = [];
  for (let from = 0; ; from += 1000) { // PostgREST returns at most 1000 rows a call
    const { data, error } = await sb.from('laws').select('id,kind,title,year,act_no,status,replaced_by,category,sections_count,summary').order('title').range(from, from + 999);
    if (error) throw error; out.push(...data); if (data.length < 1000) break;
  }
  return (LAW.list = out);
}
async function openLibrary() {
  show('scrLaw');
  $('#lawBody').innerHTML = loaderHtml('Opening the library...');
  try { await loadLaws(); } catch (e) { $('#lawBody').innerHTML = `<div class="empty">Could not load the library. ${esc(e.message || '')}</div>`; return; }
  renderLaws();
}
window.openLibrary = openLibrary;

function renderLaws() {
  const box = $('#lawBody'), q = lawNorm(LAW.q);
  const chips = `<div class="law-cats">${['all', ...LAW_CATS].map(c => `<button class="${LAW.cat === c ? 'on' : ''}" data-c="${esc(c)}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>`;
  if (LAW.deep && q.length > 2) return lawDeep(box, chips);
  const withText = LAW.list.filter(l => l.sections_count > 0);
  let rows = LAW.list.filter(l => (LAW.cat === 'all' || l.category === LAW.cat) && (!q || lawNorm(`${l.title} ${l.year} ${l.act_no ? 'act ' + l.act_no : ''} ${l.summary || ''}`).includes(q)));
  rows.sort((a, b) => (b.sections_count > 0) - (a.sections_count > 0) || (a.kind === 'constitution' ? -1 : b.kind === 'constitution' ? 1 : 0) || a.title.localeCompare(b.title));
  box.innerHTML = chips + (!q && LAW.cat === 'all' ? `<div class="law-intro"><b>${LAW.list.filter(l => l.status === 'in_force' && l.kind === 'central').length} central Acts in force</b>, plus the Constitution. Full text for ${withText.length} so far; the rest open on India Code. Tap "Search inside the text" to search every section.</div>` : '')
    + `<p class="muted small">${rows.length} result${rows.length === 1 ? '' : 's'}</p>`
    + rows.slice(0, 300).map(l => `<button class="item law-row" data-id="${l.id}"><div class="t">
        <div><b>${esc(l.title)}</b>${l.year ? `, ${l.year}` : ''}</div>
        <div class="muted small">${l.kind === 'constitution' ? 'Constitution' : l.act_no ? `Act ${esc(l.act_no)} of ${l.year}` : l.year || ''}${l.category && l.kind !== 'constitution' ? ' · ' + esc(l.category) : ''}</div>
        ${l.summary ? `<div class="small law-sum">${esc(l.summary)}</div>` : ''}</div>
        ${l.status === 'repealed' ? '<span class="tag rejected">Repealed</span>' : l.sections_count ? `<span class="tag resolved">${l.sections_count} ${l.kind === 'constitution' ? 'articles' : 'sections'}</span>` : ''}</button>`).join('')
    + (rows.length > 300 ? `<p class="muted small">Showing 300. Type more to narrow it down.</p>` : '')
    + (rows.length ? '' : '<div class="empty">No Act by that name. Try "Search inside the text".</div>');
  box.querySelectorAll('.law-cats button').forEach(b => b.onclick = () => { LAW.cat = b.dataset.c; renderLaws(); });
  box.querySelectorAll('.law-row').forEach(b => b.onclick = () => openAct(+b.dataset.id));
}
let lawDeepT = null, lawDeepSeq = 0;
function lawDeep(box, chips) {
  box.innerHTML = chips + '<p class="muted small">Searching every section...</p>';
  clearTimeout(lawDeepT); const seq = ++lawDeepSeq;
  lawDeepT = setTimeout(async () => {
    const { data, error } = await sb.rpc('law_search', { q: LAW.q, lim: 60 });
    if (seq !== lawDeepSeq) return;
    if (error) { box.innerHTML = chips + `<div class="empty">${esc(error.message)}</div>`; return; }
    box.innerHTML = chips + `<p class="muted small">${data.length} section${data.length === 1 ? ' mentions' : 's mention'} "${esc(LAW.q)}" (full text is loaded for ${LAW.list.filter(l => l.sections_count).length} laws)</p>`
      + data.map(r => `<button class="item law-hit" data-law="${r.law_id}" data-sec="${r.section_id}"><div class="t">
          <div class="muted small">${esc(r.law_title)}${r.law_year ? ', ' + r.law_year : ''}</div>
          <div><b>${/^\d/.test(r.num) ? (r.law_title.startsWith('Constitution') ? 'Article ' : 'Section ') : ''}${esc(r.num)}</b> ${esc(r.title || '')}</div>
          <div class="small law-sum">${esc(r.snippet).replace(/«/g, '<mark>').replace(/»/g, '</mark>')}</div></div></button>`).join('');
    box.querySelectorAll('.law-cats button').forEach(b => b.onclick = () => { LAW.cat = b.dataset.c; LAW.deep = false; $('#lawDeep').checked = false; renderLaws(); });
    box.querySelectorAll('.law-hit').forEach(b => b.onclick = () => openAct(+b.dataset.law, +b.dataset.sec));
  }, 450);
}

async function openAct(id, focusSec) {
  const l = LAW.list.find(x => x.id === id); if (!l) return;
  LAW.act = l; LAW.secQ = '';
  $('#lawActTitle').textContent = l.kind === 'constitution' ? 'Constitution' : `${l.year || ''} Act`;
  show('scrLawAct');
  const box = $('#lawActBody');
  const head = `<h2 class="law-h">${esc(l.title)}${l.year && l.kind !== 'constitution' ? `, ${l.year}` : ''}</h2>
    <div class="muted small">${l.kind === 'constitution' ? 'In force since 26 January 1950' : `${l.act_no ? `Act No. ${esc(l.act_no)} of ${l.year} · ` : ''}${l.status === 'repealed' ? '<b class="danger">Repealed</b>' : 'In force'}`}${l.category ? ' · ' + esc(l.category) : ''}</div>
    ${l.replaced_by ? `<div class="law-note">Replaced by the <b>${esc(l.replaced_by)}</b> from 1 July 2024. Use this one only for cases from before that date.</div>` : ''}
    ${l.summary ? `<p class="law-sum">${esc(l.summary)}</p>` : ''}
    <a class="pa" target="_blank" rel="noopener" href="https://www.indiacode.nic.in/simple-search?query=${encodeURIComponent(l.title)}">Official text on India Code</a>`;
  if (!l.sections_count) { box.innerHTML = head + '<p class="muted small" style="margin-top:14px">Full text of this Act is not in the app yet. Open it on India Code above.</p>'; return; }
  box.innerHTML = head + loaderHtml('Loading sections...');
  const { data, error } = await sb.from('law_sections').select('id,ord,num,title,chapter,body').eq('law_id', id).order('ord');
  if (error) { box.innerHTML = head + `<div class="empty">${esc(error.message)}</div>`; return; }
  LAW.secs = data;
  const word = l.kind === 'constitution' ? 'Article' : 'Section';
  box.innerHTML = head + `<input id="secQ" placeholder="Find ${word === 'Article' ? 'an article' : 'a section'} by number or word" autocomplete="off" style="margin-top:14px"><div id="secList"></div>
    <p class="muted small" style="margin-top:14px">Text from an open dataset of the official text${l.kind === 'constitution' || l.title === 'Motor Vehicles Act' ? '. Recent amendments may be missing, so check India Code before relying on it in a complaint' : ''}.</p>`;
  const draw = () => {
    const q = lawNorm(LAW.secQ), isNum = /^\d+[a-z]?$/.test(q);
    const rows = !q ? data : data.filter(s => isNum ? lawNorm(s.num) === q || lawNorm(s.num).startsWith(q) : lawNorm(`${s.num} ${s.title} ${s.body}`).includes(q));
    let lastCh = null;
    $('#secList').innerHTML = rows.map(s => { const ch = s.chapter && s.chapter !== lastCh ? `<div class="law-ch">${esc(s.chapter)}</div>` : ''; lastCh = s.chapter;
      return ch + `<details class="law-sec" id="sec-${s.id}" ${s.id === focusSec || (isNum && rows.length === 1) ? 'open' : ''}><summary><b>${/^\d/.test(s.num) ? word + ' ' : ''}${esc(s.num)}</b> ${s.title && s.title !== s.num ? esc(s.title) : ''}</summary><div class="law-text">${esc(s.body || '')}</div></details>`; }).join('') || '<div class="empty">No match in this law.</div>';
  };
  draw();
  $('#secQ').addEventListener('input', e => { LAW.secQ = e.target.value; draw(); });
  if (focusSec) setTimeout(() => { const el = document.getElementById('sec-' + focusSec); if (el) el.scrollIntoView({ block: 'center' }); }, 60);
}
window.openAct = openAct;

$('#lawQ').addEventListener('input', e => { LAW.q = e.target.value; if (LAW.list) renderLaws(); });
$('#lawDeep').addEventListener('change', e => { LAW.deep = e.target.checked; if (LAW.list) renderLaws(); });
