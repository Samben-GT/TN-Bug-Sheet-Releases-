/* Wikipedia profiles: the admin runs "Find on Wikipedia" from Photo slots; the phone asks Wikipedia directly
 * (its API allows this), matches each MLA, party or officer to a page, and saves the page title, short summary
 * and, only when it is a Wikimedia Commons file, the photo. Weak matches wait for the admin to accept.
 * Tiles show the summary with credit (Wikipedia text is CC BY-SA) and a link to the full page. */
const PW = { map: null };
const WIKI_API = 'https://en.wikipedia.org/w/api.php', WIKI_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
async function loadWiki(force) {
  if (PW.map && !force) return;
  const { data } = await sb.from('people_wiki').select('*');
  PW.map = new Map((data || []).map(x => [x.key, x]));
}
const wikiOk = w => w && (w.status === 'auto' || w.status === 'approved');
const normW = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
async function wikiSearch(q) {
  const r = await fetch(`${WIKI_API}?action=query&list=search&srlimit=5&format=json&origin=*&srsearch=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('Wikipedia search failed (' + r.status + ')');
  return ((await r.json()).query || {}).search || [];
}
async function wikiSummary(title) {
  const r = await fetch(WIKI_REST + encodeURIComponent(title.replace(/ /g, '_')));
  return r.ok ? r.json() : null;
}
// score a candidate page for one slot: 2 = sure, 1 = possible (admin checks), 0 = no
const BAD_TITLE = /ministry|cabinet|election|list of|constituency|assembly|council of|government of|filmography|discography/i;
function wikiScore(slot, s) {
  if (!s || s.type === 'disambiguation' || BAD_TITLE.test(s.title)) return 0;
  const text = normW(`${s.title} ${s.description || ''} ${s.extract || ''}`), title = normW(s.title);
  const nameTok = normW(slot.name).split(' ').filter(t => t.length >= 4);
  const nameHit = nameTok.length ? nameTok.some(t => title.includes(t)) : title.includes(normW(slot.name));
  if (slot.kind === 'party') return normW(slot.full).split(' ').filter(t => t.length > 3).every(t => text.includes(t)) ? 2 : 0;
  if (!nameHit || !text.includes('tamil nadu') && !text.includes('india')) return 0;
  if (slot.kind === 'mla') {
    const place = normW(slot.place.replace(/\((sc|st)\)/i, ''));
    const role = /legislative assembly|member of the|mla|politician|minister/.test(text);
    if (place && text.includes(place) && role) return 2;
    return role ? 1 : 0;
  }
  return /indian administrative service|indian police service|\bias\b|\bips\b|police|civil servant|bureaucrat/.test(text) ? 2 : 1;
}
async function wikiFindOne(slot) {
  const q = slot.kind === 'party' ? slot.full : slot.kind === 'mla' ? `${slot.name} ${slot.place.replace(/\((SC|ST)\)/, '')} Tamil Nadu` : `${slot.name} ${slot.sub || ''} Tamil Nadu`;
  const hits = await wikiSearch(q);
  let best = null, bestScore = 0;
  for (const h of hits.filter(h => !BAD_TITLE.test(h.title)).slice(0, 3)) {
    const s = await wikiSummary(h.title); const sc = wikiScore(slot, s);
    if (sc > bestScore) { best = s; bestScore = sc; if (sc === 2) break; }
  }
  if (!best) return null;
  const thumb = best.thumbnail && best.thumbnail.source || null;
  return { key: slot.key, title: best.title, page_url: (best.content_urls && best.content_urls.desktop && best.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(best.title)),
    description: (best.description || '').slice(0, 300) || null, extract: (best.extract || '').slice(0, 2000) || null,
    thumb: thumb ? thumb.slice(0, 600) : null, thumb_commons: !!(thumb && thumb.includes('/wikipedia/commons/')),
    status: bestScore === 2 ? 'auto' : 'review', reason: bestScore === 2 ? 'name, place and role match' : 'name matches, place or role not confirmed', checked_on: new Date().toISOString() };
}
// admin: run over the current group in Photo slots
async function wikiRun(slots, force) {
  await loadWiki(true);
  const todo = slots.filter(x => force || !PW.map.has(x.key));
  if (!todo.length) return toast('Everyone here was already checked. Long-press to recheck all.', 3000);
  const btn = $('#fWiki'); let found = 0, review = 0, none = 0, i = 0;
  for (const slot of todo) {
    i++; if (btn) btn.textContent = `Checking Wikipedia ${i}/${todo.length} · ${found} found`;
    try {
      const row = await wikiFindOne(slot);
      const rec = row || { key: slot.key, title: '-', page_url: '-', status: 'rejected', reason: 'no matching Wikipedia page found', checked_on: new Date().toISOString() };
      const { error } = await sb.from('people_wiki').upsert(rec); if (error) throw error;
      row ? (row.status === 'auto' ? found++ : review++) : none++;
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); continue; } // Wikipedia busy: wait and move on
    await new Promise(r => setTimeout(r, 400)); // be polite to Wikipedia
  }
  await loadWiki(true);
  toast(`Wikipedia: ${found} matched, ${review} to check, ${none} without a page`, 4000);
  if (typeof renderFaces === 'function') renderFaces();
}
function wikiReview(key, name) {
  const w = PW.map.get(key); if (!w) return;
  $('#mTitle').textContent = 'Is this ' + name + '?';
  $('#mBody').innerHTML = `${w.thumb ? `<img src="${esc(w.thumb)}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:12px;float:right;margin-left:10px">` : ''}
    <p><b>${esc(w.title)}</b><br><span class="muted small">${esc(w.description || '')}</span></p><p class="small">${esc((w.extract || '').slice(0, 400))}</p>
    <p class="small"><a href="${esc(w.page_url)}" target="_blank" rel="noopener">Open on Wikipedia</a> · ${esc(w.reason || '')}</p>`;
  $('#mOk').textContent = 'Yes, same person'; $('#mCancel').textContent = 'No';
  const done = async st => { await sb.from('people_wiki').update({ status: st }).eq('key', key); await loadWiki(true); $('#modal').classList.remove('on'); $('#mCancel').textContent = 'Cancel'; renderFaces(); };
  $('#mOk').onclick = () => done('approved'); $('#mCancel').onclick = () => done('rejected');
  $('#modal').classList.add('on');
}
// tile helpers
function wikiThumb(key) { const w = PW.map && PW.map.get(key); return wikiOk(w) && w.thumb_commons ? w.thumb : null; }
async function fillWiki(key, el) {
  if (!el) return;
  try { await loadWiki(); } catch (_) { return; }
  const w = PW.map.get(key); if (!wikiOk(w)) { el.innerHTML = ''; return; }
  if (w.title === '-') { el.innerHTML = w.thumb ? `<div class="wiki"><div class="src">Photo: <a href="${esc(w.page_url)}" target="_blank" rel="noopener">Wikimedia Commons</a> (free licence, credit on the file page)</div></div>` : ''; return; }
  el.innerHTML = `<div class="wiki"><p class="wiki-x">${esc(w.extract || w.description || '')}</p>
    <div class="src"><a href="${esc(w.page_url)}" target="_blank" rel="noopener">Read more on Wikipedia</a> · text CC BY-SA${wikiThumb(key) ? ' · photo Wikimedia Commons' : ''}</div></div>`;
}
