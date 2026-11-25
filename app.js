'use strict';
/* 블로그 현장노트 — 현장에서 사진·동영상을 찍고 말로 설명을 녹음해 두었다가,
   글 한 편씩 패키지(ZIP)로 내보내 PC의 Claude가 블로그 초안을 만든다.
   재고실사 앱(inventory-count)의 촬영·녹음·저장·ZIP 코드를 가져와 고쳐 씀. */

/* ================= 작은 도구들 ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + 'MB';
const pad2 = n => String(n).padStart(2, '0');

function ask(msg, yes, no) {
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'sheet-bg';
    d.innerHTML = `<div class="sheet"><p>${esc(msg)}</p>
      <button class="btn primary big" data-a="1">${esc(yes)}</button>
      <button class="btn big" data-a="0">${esc(no)}</button></div>`;
    d.onclick = e => {
      const b = e.target.closest('[data-a]');
      if (!b && e.target !== d) return;
      d.remove();
      res(!!b && b.dataset.a === '1');
    };
    document.body.appendChild(d);
  });
}
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ================= 저장소 (IndexedDB, 휴대폰 안에만) =================
   posts: {id, place, date, paid:'own'|'sponsored', note, order:[mediaId], created, updated, exported, cleaned}
   media: {id, postId, kind:'photo'|'video'|'audio', blob, type, size, text, photoId?, sec?, created} */
let db;
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('blog-fieldnote', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('posts', { keyPath: 'id' });
      d.createObjectStore('media', { keyPath: 'id' }).createIndex('postId', 'postId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const os = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
const DB = {
  get: (s, k) => reqP(os(s).get(k)),
  getAll: s => reqP(os(s).getAll()),
  put: (s, v) => reqP(os(s, 'readwrite').put(v)),
  del: (s, k) => reqP(os(s, 'readwrite').delete(k)),
  mediaOf: id => reqP(os('media').index('postId').getAll(id)),
};
const savePost = p => { p.updated = now(); return DB.put('posts', p); };

/* ================= 화면 이동 ================= */
let urls = [];
const objUrl = b => { if (!b) return ''; const u = URL.createObjectURL(b); urls.push(u); return u; };
function go(h) { if (location.hash === h) render(); else location.hash = h; }
window.addEventListener('hashchange', render);
async function render() {
  urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
  $$('.sheet-bg').forEach(d => d.remove());
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/post\/(.+)$/))) return renderPost(m[1]);
  if ((m = h.match(/^#\/m\/(.+)$/))) return renderMedia(m[1]);
  return renderHome();
}

/* ================= 1. 글 목록 ================= */
async function renderHome() {
  const posts = (await DB.getAll('posts')).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const counts = {};
  for (const p of posts) counts[p.id] = (p.order || []).length;
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `앱이 쓰는 공간 ${mb(e.usage || 0)}`; } catch {}
  $('#app').innerHTML = `
    <header class="bar"><h1>📷 블로그 현장노트</h1></header>
    <main class="pad">
      <button class="btn primary big" id="newPost">＋ 새 글 (지금 있는 곳)</button>
      ${posts.length ? '' : '<p class="hint">새 글을 만들고 사진·동영상을 찍은 뒤, 사진마다 말로 설명을 녹음하세요. 다 찍으면 패키지를 내보내 PC의 Claude에게 주면 초안이 나옵니다.</p>'}
      <div class="list">${posts.map(p => `
        <a class="row" href="#/post/${p.id}">
          <div class="main"><div class="name">${esc(p.place || '(이름 없음)')}</div>
            <div class="sub">${esc(p.date || '')} · ${p.paid === 'sponsored' ? '협찬' : '내돈내산'}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
          <div class="side">${counts[p.id]}장${p.cleaned ? '<br><span class="small muted">정리됨</span>' : p.exported ? '<br><span class="small ok">내보냄</span>' : ''}</div>
        </a>`).join('')}</div>
      <p class="small muted" style="margin-top:16px">${usage}${usage ? ' · ' : ''}기록은 이 휴대폰 안에만 저장됩니다.</p>
    </main>`;
  $('#newPost').onclick = newPost;
}
async function newPost() {
  const place = prompt('어디인가요? (가게·장소 이름)', '');
  if (place === null) return;
  const p = { id: uid(), place: place.trim(), date: today(), paid: 'own', note: '', order: [], created: now() };
  await savePost(p);
  go('#/post/' + p.id);
}

/* ================= 2. 글 화면: 찍기·순서·총평·내보내기 ================= */
async function renderPost(id) {
  const p = await DB.get('posts', id);
  if (!p) return go('#/');
  const all = await DB.mediaOf(id);
  const byId = Object.fromEntries(all.map(m => [m.id, m]));
  p.order = (p.order || []).filter(x => byId[x]);
  const notes = m => all.filter(a => a.kind === 'audio' && a.photoId === m.id);
  const overall = all.filter(a => a.kind === 'audio' && !a.photoId);
  if (location.hash !== '#/post/' + id) return;

  $('#app').innerHTML = `
    <header class="bar"><a class="back" href="#/">← 목록</a><h1>${esc(p.place || '(이름 없음)')}</h1></header>
    <main class="pad post">
      <section class="card">
        <div class="field"><span>장소</span><input id="place" value="${esc(p.place)}"></div>
        <div class="field"><span>날짜</span><input id="date" type="date" value="${esc(p.date)}"></div>
        <div class="field"><span>구분</span>
          <select id="paid"><option value="own" ${p.paid !== 'sponsored' ? 'selected' : ''}>내돈내산</option><option value="sponsored" ${p.paid === 'sponsored' ? 'selected' : ''}>협찬 (글 맨 위 표시)</option></select></div>
        <div class="field"><span>한줄 메모</span><input id="note" value="${esc(p.note || '')}" placeholder="예: 가격, 같이 간 사람"></div>
      </section>

      <div class="quick">
        <label class="btn primary">📷 사진<input type="file" accept="image/*" capture="environment" id="camPhoto" hidden></label>
        <label class="btn primary">🎬 동영상<input type="file" accept="video/*" capture="environment" id="camVideo" hidden></label>
      </div>
      <label class="btn" style="width:100%;margin-top:8px">🖼 갤러리에서 가져오기 (여러 장)<input type="file" accept="image/*,video/*" multiple id="gallery" hidden></label>
      ${p.cleaned ? '<p class="hint">내보낸 뒤 정리한 글이라 사진·영상 파일은 지워졌습니다. 글 기록만 남아 있습니다.</p>' : ''}

      <h2 style="margin-top:18px">글 순서 <span class="muted small">${p.order.length}개 · ↑↓로 순서 바꾸기</span></h2>
      <div class="seq">${p.order.map((mid, k) => {
        const m = byId[mid]; const ns = notes(m);
        const said = ns.map(n => n.text).filter(Boolean).join(' ');
        return `<div class="seqrow">
          <a class="seqthumb" href="#/m/${m.id}">${m.kind === 'video'
            ? `<video src="${objUrl(m.blob)}#t=0.1" preload="metadata" muted playsinline></video><span class="vtag">▶ ${mb(m.size || m.blob.size)}</span>`
            : `<img src="${objUrl(m.blob)}" alt="">`}<span class="no">${pad2(k + 1)}</span></a>
          <a class="seqbody" href="#/m/${m.id}">
            <div class="small">${ns.length ? `🎙 ${ns.length}개` : '<span class="warn">설명 없음</span>'}${m.text ? ' · ✏️' : ''}</div>
            <div class="said">${esc(m.text ? m.text + ' ' : '')}${esc(said) || '<span class="muted">눌러서 설명 녹음</span>'}</div></a>
          <div class="seqbtns">
            <button class="btn small" data-up="${k}" ${k ? '' : 'disabled'}>↑</button>
            <button class="btn small" data-rec="${m.id}">🎙</button>
            <button class="btn small" data-down="${k}" ${k < p.order.length - 1 ? '' : 'disabled'}>↓</button>
          </div></div>`;
      }).join('') || '<p class="muted">아직 없습니다. 위에서 찍어 주세요.</p>'}</div>

      <section class="card" style="margin-top:14px">
        <h2>총평 녹음 <span class="muted small">맛·가격·재방문·추천 대상 등 전체 소감</span></h2>
        ${overall.map((c, j) => `
          <div class="memo"><span class="small">#${j + 1}${c.sec ? ` ${c.sec}초` : ''}</span><audio controls preload="metadata" src="${objUrl(c.blob)}"></audio><button class="btn small" data-adel="${c.id}">삭제</button></div>
          <textarea class="memo-text" data-atext="${c.id}" rows="2" placeholder="받아쓰기 (고치거나 직접 적어도 돼요)">${esc(c.text || '')}</textarea>`).join('')}
        <button class="btn primary" id="recAll" style="width:100%">🎙 총평 녹음</button>
      </section>

      <section class="card">
        <h2>PC로 보내기</h2>
        <button class="btn primary big" id="export">📦 블로그 패키지 내보내기</button>
        <p class="small muted">ZIP 파일을 카카오톡 나에게 보내기·구글 드라이브 등으로 PC에 옮긴 뒤 Claude에게 "초안 만들어 줘"라고 하세요.</p>
        ${p.exported && !p.cleaned ? '<button class="btn danger" id="clean" style="width:100%">🧹 정리: 사진·영상 파일 지워 공간 확보 (글 기록은 남김)</button>' : ''}
        <button class="btn danger small" id="delPost" style="margin-top:10px">이 글 통째로 삭제</button>
      </section>
    </main>`;

  // 글 정보: 입력하는 대로 저장
  for (const k of ['place', 'date', 'paid', 'note']) {
    $('#' + k).onchange = async () => { p[k] = $('#' + k).value.trim(); await savePost(p); if (k === 'place') $('.bar h1').textContent = p.place; };
  }
  $('#camPhoto').onchange = e => addFiles(p, e.target.files, true);
  $('#camVideo').onchange = e => addFiles(p, e.target.files, true);
  $('#gallery').onchange = e => addFiles(p, e.target.files, false);
  const swap = async (a, b) => { [p.order[a], p.order[b]] = [p.order[b], p.order[a]]; await savePost(p); render(); };
  $$('[data-up]').forEach(b => b.onclick = () => swap(+b.dataset.up, +b.dataset.up - 1));
  $$('[data-down]').forEach(b => b.onclick = () => swap(+b.dataset.down, +b.dataset.down + 1));
  $$('[data-rec]').forEach(b => b.onclick = () => toggleRec(p.id, b.dataset.rec, `${pad2(p.order.indexOf(b.dataset.rec) + 1)}번 설명`));
  $('#recAll').onclick = () => toggleRec(p.id, null, '총평');
  $$('[data-atext]').forEach(t => t.onchange = async () => { const c = await DB.get('media', t.dataset.atext); if (c) { c.text = t.value.trim(); await DB.put('media', c); } });
  $$('[data-adel]').forEach(b => b.onclick = async () => { if (confirm('이 녹음을 지울까요?')) { await DB.del('media', b.dataset.adel); render(); } });
  $('#export').onclick = () => exportPost(p.id);
  if ($('#clean')) $('#clean').onclick = () => cleanPost(p.id);
  $('#delPost').onclick = async () => {
    if (!confirm(`"${p.place}" 글과 사진·녹음을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
    for (const m of all) await DB.del('media', m.id);
    await DB.del('posts', p.id);
    go('#/');
  };
}

/* ================= 3. 사진·동영상 한 개: 크게 보기·메모·설명 녹음 ================= */
async function renderMedia(mid) {
  const m = await DB.get('media', mid);
  if (!m) return go('#/');
  const p = await DB.get('posts', m.postId);
  const all = await DB.mediaOf(m.postId);
  const ns = all.filter(a => a.kind === 'audio' && a.photoId === mid).sort((a, b) => a.created.localeCompare(b.created));
  const k = p.order.indexOf(mid);
  if (location.hash !== '#/m/' + mid) return;
  $('#app').innerHTML = `
    <header class="bar"><a class="back" href="#/post/${p.id}">← 글</a><h1>${pad2(k + 1)} / ${p.order.length} · ${m.kind === 'video' ? '동영상' : '사진'}</h1></header>
    <main class="pad">
      <div class="stage">${m.kind === 'video'
        ? `<video src="${objUrl(m.blob)}" controls playsinline style="width:100%;border-radius:10px"></video>`
        : `<img src="${objUrl(m.blob)}" alt="">`}</div>
      <button class="btn primary big" id="rec">🎙 ${ns.length ? '설명 더 녹음' : `이 ${m.kind === 'video' ? '영상' : '사진'} 말로 설명`}</button>
      ${ns.length ? `<section class="card" style="margin-top:6px">
        <h2>말로 한 설명 <span class="muted small">${ns.length}개 · 받아쓰기는 고치지 않아도 Claude가 알아서 다듬어요</span></h2>
        ${ns.map((c, j) => `
          <div class="memo"><span class="small">#${j + 1}${c.sec ? ` ${c.sec}초` : ''}</span><audio controls preload="metadata" src="${objUrl(c.blob)}"></audio><button class="btn small" data-cdel="${c.id}">삭제</button></div>
          ${c.text ? `<p class="memo-said">${esc(c.text)}</p>` : '<p class="small muted">받아쓰기 없음 (녹음 파일은 PC에서 글로 바꿉니다)</p>'}
          <details class="small"><summary>받아쓰기 고치기</summary><textarea class="memo-text" data-ctext="${c.id}" rows="2">${esc(c.text || '')}</textarea></details>`).join('')}
      </section>` : ''}
      <details ${m.text ? 'open' : ''} style="margin-top:8px"><summary class="small muted">✏️ 글로 메모 (선택)</summary>
        <textarea id="cap" rows="2" placeholder="예: 대표 메뉴, 이 사진은 꼭 첫 장">${esc(m.text || '')}</textarea></details>
      <div class="row2">
        <button class="btn" id="prev" ${k > 0 ? '' : 'disabled'}>◀ 이전</button>
        <button class="btn danger" id="del">삭제</button>
        <button class="btn" id="next" ${k < p.order.length - 1 ? '' : 'disabled'}>다음 ▶</button>
      </div>
    </main>`;
  let t;
  const saveCap = async () => { clearTimeout(t); const v = $('#cap'); if (!v) return; m.text = v.value.trim(); await DB.put('media', m); };
  $('#cap').oninput = () => { clearTimeout(t); t = setTimeout(saveCap, 400); };
  $('#cap').onblur = saveCap;
  $('#prev').onclick = async () => { await saveCap(); go('#/m/' + p.order[k - 1]); };
  $('#next').onclick = async () => { await saveCap(); go('#/m/' + p.order[k + 1]); };
  $('#rec').onclick = () => toggleRec(p.id, m.id, `${pad2(k + 1)}번 설명`);
  $$('[data-ctext]').forEach(x => x.onchange = async () => { const c = await DB.get('media', x.dataset.ctext); if (c) { c.text = x.value.trim(); await DB.put('media', c); } });
  $$('[data-cdel]').forEach(b => b.onclick = async () => { if (confirm('이 녹음을 지울까요?')) { await DB.del('media', b.dataset.cdel); render(); } });
  $('#del').onclick = async () => {
    if (!confirm(`이 ${m.kind === 'video' ? '동영상' : '사진'}을 지울까요?${ns.length ? ` 설명 녹음 ${ns.length}개도 함께 지워집니다.` : ''}`)) return;
    for (const c of ns) await DB.del('media', c.id);
    await DB.del('media', m.id);
    p.order = p.order.filter(x => x !== m.id);
    await savePost(p);
    go('#/post/' + p.id);
  };
}

/* ================= 사진·동영상 저장 ================= */
const PHOTO_MAX = 2400; // 블로그용: 긴 변 2400px (재고 앱은 1600)
async function shrink(file, max = PHOTO_MAX) {
  try {
    const bmp = await createImageBitmap(file);
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.9));
  } catch { return file; }
}
// 받은 순서대로 한 개씩 저장 (연달아 찍어도 순서가 섞이지 않게)
let saveQueue = Promise.resolve();
function addFiles(p, files, fromCamera) {
  const list = [...(files || [])];
  if (!list.length) return;
  saveQueue = saveQueue.then(() => saveFiles(p.id, list, fromCamera)).catch(e => { console.error(e); toast('저장에 실패했어요: ' + e.message, 4000); });
}
async function saveFiles(postId, files, fromCamera) {
  toast('저장 중…');
  const p = await DB.get('posts', postId);
  let last = null;
  // 갤러리에서 고른 것은 찍은 시각 순으로
  if (!fromCamera) files.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  for (const f of files) {
    const video = (f.type || '').startsWith('video/');
    const blob = video ? f : await shrink(f);
    const m = { id: uid(), postId, kind: video ? 'video' : 'photo', type: blob.type || f.type, size: blob.size, blob, text: '', created: now(), taken: f.lastModified ? new Date(f.lastModified).toISOString() : null };
    await DB.put('media', m);
    p.order.push(m.id);
    last = m;
  }
  p.cleaned = false;
  await savePost(p);
  render();
  // 카메라로 찍으면 바로 녹음 시작 (말할 게 없으면 바로 정지 → 1초 미만은 버림)
  if (fromCamera && last && !rec) {
    await toggleRec(postId, last.id, `${pad2(p.order.length)}번 ${last.kind === 'video' ? '영상' : '사진'} 설명 — 말하고 정지`);
  } else toast(`${files.length}개를 저장했어요`);
}

/* ================= 녹음 + 받아쓰기 ================= */
let rec = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function startStt(r) {
  if (!SR) return;
  try {
    const sr = new SR();
    sr.lang = 'ko-KR'; sr.continuous = true; sr.interimResults = false;
    r.text = '';
    sr.onresult = e => { for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) r.text += e.results[k][0].transcript.trim() + ' '; };
    sr.onerror = () => {};
    sr.onend = () => { if (r.sttLive) try { sr.start(); } catch {} };
    r.sr = sr; r.sttLive = true;
    sr.start();
  } catch { r.sr = null; }
}
function finishStt(r) {
  return new Promise(res => {
    if (!r.sr) return res();
    r.sttLive = false;
    const t = setTimeout(res, 1500);
    r.sr.onend = () => { clearTimeout(t); res(); };
    try { r.sr.stop(); } catch { clearTimeout(t); res(); }
  });
}
async function toggleRec(postId, photoId, label) {
  if (rec) return stopRec();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('이 브라우저는 녹음을 지원하지 않아요.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast('마이크를 쓸 수 없어요. 브라우저의 마이크 권한을 확인해 주세요.', 3500); }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t));
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const r = { mr, start: Date.now() };
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    clearInterval(r.timer);
    await finishStt(r);
    rec = null;
    $('#recbar').classList.add('hidden');
    const blob = new Blob(chunks, { type: (mr.mimeType || type || 'audio/webm').split(';')[0] });
    const sec = ((r.stopAt || Date.now()) - r.start) / 1000;
    if (sec < 1.2) toast('녹음 안 함');
    else if (blob.size) {
      await DB.put('media', { id: uid(), postId, kind: 'audio', type: blob.type, size: blob.size, blob, sec: Math.round(sec), text: (r.text || '').trim(), created: now(), ...(photoId ? { photoId } : {}) });
      toast(photoId ? '설명을 붙였어요' : '총평을 저장했어요');
    }
    render();
  };
  rec = r;
  mr.start();
  startStt(r);
  $('#recwhat').textContent = label || '';
  $('#recbar').classList.remove('hidden');
  const tick = () => { const s = Math.floor((Date.now() - r.start) / 1000); $('#rectime').textContent = `● ${Math.floor(s / 60)}:${pad2(s % 60)}`; };
  tick(); r.timer = setInterval(tick, 500);
}
function stopRec() {
  if (!rec) return;
  rec.sttLive = false;
  rec.stopAt = Date.now();
  clearInterval(rec.timer);
  $('#rectime').textContent = '저장 중…';
  if (rec.mr.state !== 'inactive') rec.mr.stop();
}
$('#recstop').onclick = stopRec;

/* ================= 내보내기: 블로그 패키지 ZIP ================= */
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 40) || '글';
const extOf = (t, kind) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' }[(t || '').split(';')[0]] || (kind === 'video' ? 'mp4' : 'bin'));

function requestMd(p, items, overall) {
  const L = [];
  L.push(`# 블로그 초안 요청 — ${p.place}`, '');
  L.push(`- 장소: ${p.place}`, `- 날짜: ${p.date}`, `- 구분: ${p.paid === 'sponsored' ? '협찬 (글 맨 위에 경제적 대가 표시 필수)' : '내돈내산'}`);
  if (p.note) L.push(`- 메모: ${p.note}`);
  L.push(`- 사진·동영상 ${items.length}개 (번호 = 글에 들어갈 순서)`, '');
  L.push('## Claude가 할 일', '');
  L.push('1. `tistory-blog/NAVER_REVIEW_RULES.md`(네이버 리뷰 규칙)를 먼저 읽는다.');
  L.push('2. 사진을 직접 보고 아래 설명(받아쓰기)과 맞춰 본다. 받아쓰기가 비었으면 녹음 파일을 글로 바꾼다.');
  L.push('3. 가격·메뉴·시간·위치 같은 사실은 설명·메모에 있는 것만 쓴다. 없는 사실은 지어내지 않고 [확인 필요]로 남긴다.');
  L.push('4. 결과: `tistory-blog/drafts/naver/<날짜_장소>/` 폴더에 `naver_draft.json`과 사진·동영상 파일(아래 파일 이름 그대로)을 둔다.');
  L.push('   형식: `{ "title": "...", "blocks": [ {"type":"text","html":"<p>...</p>"}, {"type":"image","file":"01.jpg"}, {"type":"video","file":"02.mp4"} ] }`');
  L.push('   사용자는 네이버 글쓰기 창의 "초안 자동 입력" 상자에서 이 폴더를 고른다.', '');
  L.push('## 순서별 자료', '');
  for (const it of items) {
    L.push(`### ${it.file} (${it.kind === 'video' ? '동영상' : '사진'})`);
    if (it.memo) L.push(`- 글 메모: ${it.memo}`);
    if (!it.notes.length) L.push('- 설명 녹음 없음');
    for (const n of it.notes) L.push(`- 설명 ${n.file}${n.sec ? ` (${n.sec}초)` : ''}: ${n.text || '(받아쓰기 없음 → 녹음 파일 확인)'}`);
    L.push('');
  }
  L.push('## 총평', '');
  if (!overall.length) L.push('- 총평 녹음 없음');
  for (const n of overall) L.push(`- ${n.file}${n.sec ? ` (${n.sec}초)` : ''}: ${n.text || '(받아쓰기 없음 → 녹음 파일 확인)'}`);
  return L.join('\n') + '\n';
}

async function exportPost(id) {
  if (!window.JSZip) return toast('ZIP 도구를 못 불러왔어요. 인터넷 연결 후 한 번 앱을 열어 주세요.', 4000);
  const p = await DB.get('posts', id);
  if (p.cleaned) return toast('이미 정리해서 파일이 없는 글이에요.');
  const all = await DB.mediaOf(id);
  const byId = Object.fromEntries(all.map(m => [m.id, m]));
  const order = (p.order || []).filter(x => byId[x]);
  if (!order.length) return toast('찍은 사진이 없어요.');
  const total = order.reduce((s, x) => s + (byId[x].size || byId[x].blob.size), 0);
  if (total > 400 * 1048576 && !confirm(`파일이 ${mb(total)}로 큽니다. 휴대폰에서 ZIP 만들기가 느리거나 실패할 수 있어요. 계속할까요?`)) return;
  toast('패키지 만드는 중…', 60000);
  const zip = new JSZip();
  const items = order.map((mid, k) => {
    const m = byId[mid];
    const no = pad2(k + 1);
    const file = `${no}.${extOf(m.type, m.kind)}`;
    zip.file(file, m.blob);
    const notes = all.filter(a => a.kind === 'audio' && a.photoId === mid).sort((a, b) => a.created.localeCompare(b.created)).map((a, j) => {
      const f = `${no}_설명${j + 1}.${extOf(a.type)}`;
      zip.file('녹음/' + f, a.blob);
      return { file: '녹음/' + f, sec: a.sec, text: a.text || '' };
    });
    return { no: k + 1, file, kind: m.kind, memo: m.text || '', taken: m.taken, notes };
  });
  const overall = all.filter(a => a.kind === 'audio' && !a.photoId).sort((a, b) => a.created.localeCompare(b.created)).map((a, j) => {
    const f = `총평${j + 1}.${extOf(a.type)}`;
    zip.file('녹음/' + f, a.blob);
    return { file: '녹음/' + f, sec: a.sec, text: a.text || '' };
  });
  zip.file('data.json', JSON.stringify({ format: 'blog-fieldnote', version: 1, exported: now(), post: { place: p.place, date: p.date, paid: p.paid, note: p.note }, items, overall }, null, 1));
  zip.file('초안요청.md', requestMd(p, items, overall));
  // 사진·영상은 이미 압축된 파일이라 다시 압축하지 않는다 (휴대폰 부담 줄이기)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const name = `${p.date}_${safeName(p.place)}_블로그패키지.zip`;
  const file = new File([blob], name, { type: 'application/zip' });
  p.exported = now();
  await savePost(p);
  toast('패키지 완성', 1500);
  // 휴대폰이면 공유창(카카오톡·드라이브 등), 안 되면 다운로드
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); render(); return; } catch (e) { if (e.name === 'AbortError') { render(); return; } }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  render();
}

async function cleanPost(id) {
  const p = await DB.get('posts', id);
  const all = await DB.mediaOf(id);
  const size = all.reduce((s, m) => s + (m.size || m.blob?.size || 0), 0);
  if (!(await ask(`PC에 패키지가 잘 옮겨졌나요? 사진·영상·녹음 파일 ${mb(size)}를 지웁니다. 장소·날짜·메모와 총평 받아쓰기는 남습니다.`, '🧹 지우기', '아직'))) return;
  for (const m of all) {
    // 녹음은 받아쓰기 글을 남기고 소리 파일만 지운다. 사진·영상은 통째로 지운다.
    if (m.kind === 'audio' && !m.photoId) { m.blob = null; m.size = 0; await DB.put('media', m); }
    else await DB.del('media', m.id);
  }
  p.cleaned = now();
  p.order = [];
  await savePost(p);
  toast(`${mb(size)} 확보했어요`);
  render();
}

/* ================= 시작 ================= */
(async () => {
  db = await openDB();
  // 휴대폰이 공간 부족할 때 앱 기록을 함부로 지우지 않도록 요청
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
