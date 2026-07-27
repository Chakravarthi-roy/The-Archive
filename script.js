/* ---------- markdown ---------- */
function renderMarkdown(raw){
  if(!raw) return '';
  let text = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (m, code)=>{ codeBlocks.push(code.trim()); return '@@CODEBLOCK' + (codeBlocks.length-1) + '@@'; });
  const lines = text.split('\n');
  let html=''; let inList=null; let inQuote=false; let para=[];
  function flushPara(){ if(para.length){ html += '<p>'+para.join('<br>')+'</p>'; para=[]; } }
  function closeList(){ if(inList){ html += '</'+inList+'>'; inList=null; } }
  function closeQuote(){ if(inQuote){ html += '</blockquote>'; inQuote=false; } }
  function inlineFmt(s){
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }
  for(const line of lines){
    if(/^@@CODEBLOCK\d+@@$/.test(line.trim())){
      flushPara(); closeList(); closeQuote();
      const idx = parseInt(line.trim().match(/\d+/)[0]);
      html += '<pre><code>' + codeBlocks[idx] + '</code></pre>';
      continue;
    }
    if(/^\s*$/.test(line)){ flushPara(); closeList(); closeQuote(); continue; }
    let m;
    if(m = line.match(/^(#{1,3})\s+(.*)/)){
      flushPara(); closeList(); closeQuote();
      html += '<h'+m[1].length+'>' + inlineFmt(m[2]) + '</h'+m[1].length+'>';
      continue;
    }
    if(/^(-{3,}|\*{3,})\s*$/.test(line)){ flushPara(); closeList(); closeQuote(); html += '<hr>'; continue; }
    if(m = line.match(/^&gt;\s?(.*)/)){
      flushPara(); closeList();
      if(!inQuote){ html += '<blockquote>'; inQuote=true; }
      html += '<p>' + inlineFmt(m[1]) + '</p>';
      continue;
    }
    closeQuote();
    if(m = line.match(/^[-*]\s+(.*)/)){
      flushPara();
      if(inList!=='ul'){ closeList(); html+='<ul>'; inList='ul'; }
      html += '<li>' + inlineFmt(m[1]) + '</li>';
      continue;
    }
    if(m = line.match(/^\d+\.\s+(.*)/)){
      flushPara();
      if(inList!=='ol'){ closeList(); html+='<ol>'; inList='ol'; }
      html += '<li>' + inlineFmt(m[1]) + '</li>';
      continue;
    }
    closeList();
    para.push(inlineFmt(line));
  }
  flushPara(); closeList(); closeQuote();
  return html;
}

/* Lets a single-line input submit its form on Enter (not just via button click). */
function enterSubmits(inputEl, submitFn){
  inputEl.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); submitFn(); }
  });
}

/* ---------- data ---------- */
let people = [];       // [{id, name, img, count}]
let peopleData = {};   // { [personId]: {links, pdfs, notes} }
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function makeInitialsAvatar(name){
  const initial = (name.trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="300" height="300" fill="#D4A373"/>
    <text x="50%" y="53%" font-family="Georgia, serif" font-size="120" fill="#FFFDF8" text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function countFor(personId){
  const d = peopleData[personId];
  if(!d) return 0;
  return d.links.length + d.pdfs.length + d.notes.length;
}

/* Loads everything from Supabase. */
async function loadState(){
  people = []; peopleData = {};
  const { data: peopleRows, error: peopleErr } = await sb.from('people').select('*').order('created_at');
  if(peopleErr){ console.error('Could not load people from Supabase', peopleErr); return; }

  const ids = peopleRows.map(p=>p.id);
  const [{ data: linkRows }, { data: pdfRows }, { data: noteRows }] = ids.length ? await Promise.all([
    sb.from('links').select('*').in('person_id', ids).order('created_at', {ascending:false}),
    sb.from('pdfs').select('*').in('person_id', ids).order('created_at', {ascending:false}),
    sb.from('notes').select('*').in('person_id', ids).order('created_at', {ascending:false}),
  ]) : [{data:[]},{data:[]},{data:[]}];

  peopleRows.forEach(p=>{ peopleData[p.id] = {links:[], pdfs:[], notes:[]}; });
  (linkRows||[]).forEach(l=> peopleData[l.person_id] && peopleData[l.person_id].links.push(l));
  (pdfRows||[]).forEach(d=> peopleData[d.person_id] && peopleData[d.person_id].pdfs.push(d));
  (noteRows||[]).forEach(n=> peopleData[n.person_id] && peopleData[n.person_id].notes.push(n));

  people = peopleRows.map(p=> ({ id:p.id, name:p.name, img:p.img || makeInitialsAvatar(p.name), count: countFor(p.id) }));
}

/* Uploads a File to a Supabase Storage bucket and returns its public URL. */
async function uploadToBucket(bucket, file, pathPrefix){
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${pathPrefix}/${Date.now()}-${cleanName}`;
  const { error } = await sb.storage.from(bucket).upload(path, file);
  if(error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/* ---------- belt ---------- */
const belt = document.getElementById('belt');
const frontName = document.getElementById('front-name');
const frontCount = document.getElementById('front-count');
const mainView = document.getElementById('landing-wrap');
const detailView = document.getElementById('detail-view');

let N = 1;
let els = [];
function rebuildBelt(){
  N = people.length + 1;
  const addTileHtml = `
    <div class="person" data-i="${people.length}" data-add="1">
      <div class="add-tile"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
    </div>`;
  belt.innerHTML = people.map((p,i) => `
    <div class="person" data-i="${i}"><div class="photo-ring"><img class="photo" src="${p.img}" alt="${p.name}"></div></div>
  `).join('') + addTileHtml;
  els = [...belt.children];
}

let pos = 0, currentIndex = 0, paused = false;
const SPACING = 260, HOLD_MS = 1600, MOVE_MS = 450;
let state = 'hold', holdUntil = 0, moveStart = 0, moveFrom = 0, moveTo = 0;

function shortestDelta(i, p){ let d=(i-p)%N; if(d>N/2)d-=N; if(d<-N/2)d+=N; return d; }
function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
function startMove(dir){ moveFrom=currentIndex; moveTo=currentIndex+dir; moveStart=performance.now(); state='move'; }

function render(){
  let frontIdx = 0, frontMinAbs = Infinity;
  els.forEach((el,i)=>{
    const d = shortestDelta(i,pos), absD = Math.abs(d);
    if(absD < frontMinAbs){ frontMinAbs=absD; frontIdx=i; }
    const x = d*SPACING, z = -absD*130;
    const scale = Math.max(0.42, 1-absD*0.22);
    const opacity = Math.max(0.15, 1-absD*0.28);
    const rotY = Math.max(-35, Math.min(35, d*-22));
    const zIndex = Math.round(1000-absD*10);
    el.style.transform = `translate(-50%,-50%) translateX(${x}px) translateZ(${z}px) rotateY(${rotY}deg) scale(${scale})`;
    el.style.opacity = opacity; el.style.zIndex = zIndex;
  });
  const fp = people[frontIdx];
  frontName.textContent = fp ? fp.name : 'Add someone new';
  frontCount.textContent = fp ? (countFor(fp.id) + ' filed') : 'tap to add a person';
}
function tick(now){
  if(state==='hold'){ if(!paused && now>=holdUntil) startMove(1); }
  else if(state==='move'){
    const t = Math.min(1, (now-moveStart)/MOVE_MS);
    pos = moveFrom + (moveTo-moveFrom)*easeInOutCubic(t);
    if(t>=1){ currentIndex=((moveTo%N)+N)%N; pos=currentIndex; state='hold'; holdUntil=now+HOLD_MS; }
  }
  render();
  requestAnimationFrame(tick);
}
document.querySelector('.stage').addEventListener('mouseenter', ()=> paused=true);
document.querySelector('.stage').addEventListener('mouseleave', ()=> paused=false);
document.getElementById('btn-left').addEventListener('click', ()=> startMove(-1));
document.getElementById('btn-right').addEventListener('click', ()=> startMove(1));
belt.addEventListener('click', (e)=>{
  const el = e.target.closest('.person'); if(!el) return;
  if(el.dataset.add){ openAddPersonModal(); return; }
  openDetail(people[parseInt(el.dataset.i)]);
});

/* ---------- detail view ---------- */
let currentPerson = null;

let detailSearchQuery = '';
function matchesSearch(text){
  if(!detailSearchQuery) return true;
  return (text||'').toLowerCase().includes(detailSearchQuery);
}

function renderLinks(){
  const arr = peopleData[currentPerson.id].links;
  const filtered = arr.map((l,i)=>({...l, _i:i})).filter(l=> matchesSearch(l.title + ' ' + (l.badge||'')));
  const el = document.getElementById('detail-links');
  el.innerHTML = filtered.length ? filtered.map(l=>`
    <div class="link-item type-${l.badge.toLowerCase()}" data-link="${l._i}">
      <span class="link-badge type-${l.badge.toLowerCase()}">${l.badge}</span>
      <div class="link-title">${l.title}</div>
      <div class="link-meta">${l.meta}</div>
    </div>`).join('') : (detailSearchQuery ? `<div class="empty-group">No links match your search.</div>` : '');
  el.querySelectorAll('.link-item').forEach(item=> item.addEventListener('click', ()=>{
    const link = arr[parseInt(item.dataset.link)];
    if(link.url) window.open(link.url, '_blank', 'noopener');
  }));
}
function renderPdfs(){
  const arr = peopleData[currentPerson.id].pdfs;
  const filtered = arr.map((p,i)=>({...p, _i:i})).filter(p=> matchesSearch(p.name));
  const el = document.getElementById('detail-pdfs');
  el.innerHTML = filtered.length ? filtered.map(p=>`
    <div class="pdf-item" data-pdf="${p._i}">
      <button class="item-delete-btn" data-delete-pdf="${p._i}" title="Delete this PDF" aria-label="Delete this PDF"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
      <span class="pdf-icon">📄</span>
      <div><div class="pdf-name">${p.name}</div><div class="pdf-size">${p.size}</div></div>
    </div>`).join('') : (detailSearchQuery ? `<div class="empty-group">No PDFs match your search.</div>` : '');
  el.querySelectorAll('.pdf-item').forEach(item=> item.addEventListener('click', (e)=>{
    if(e.target.closest('.item-delete-btn')) return;
    openPdfViewer(arr[parseInt(item.dataset.pdf)]);
  }));
  el.querySelectorAll('.item-delete-btn').forEach(btn=> btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    const p = arr[parseInt(btn.dataset.deletePdf)];
    if(confirm(`Delete "${p.name}"? This can't be undone.`)) deletePdf(p);
  }));
}

async function deletePdf(pdf){
  try{
    const { error } = await sb.from('pdfs').delete().eq('id', pdf.id);
    if(error) throw error;
    if(pdf.storage_path){ sb.storage.from('pdfs').remove([pdf.storage_path]).catch(()=>{}); }
    const arr = peopleData[currentPerson.id].pdfs;
    const idx = arr.findIndex(p=> p.id === pdf.id);
    if(idx > -1) arr.splice(idx, 1);
    renderPdfs();
    updateLayout();
    currentPerson.count = countFor(currentPerson.id);
    document.getElementById('detail-sub').textContent = currentPerson.count + ' items filed';
  }catch(e){
    console.error('failed to delete pdf', e);
    alert("Couldn't delete that PDF — check your connection and try again.");
  }
}
function renderNotes(){
  const arr = peopleData[currentPerson.id].notes;
  const filtered = arr.map((n,i)=>({...n, _i:i})).filter(n=> matchesSearch(n.title + ' ' + n.body));
  const el = document.getElementById('detail-notes');
  el.innerHTML = filtered.length ? filtered.map(n=>`
    <div class="note-item" data-note="${n._i}">
      <div class="note-title">${n.title}</div>
      <div class="note-snippet">${n.body.replace(/[#>*_`\-]/g,'').slice(0,110)}</div>
      <div class="note-open-hint">Open reading view →</div>
    </div>`).join('') : (detailSearchQuery ? `<div class="empty-group">No notes match your search.</div>` : '');
  el.querySelectorAll('.note-item').forEach(item=> item.addEventListener('click', ()=> openReadingView(arr[parseInt(item.dataset.note)])));
}

/* Shows/hides whole sections based on whether the person actually has that
   kind of content — links only appear if there are links, and the notes/pdf
   split only shows the columns that have something, giving the lone column
   the full width when the other is empty. Nothing here depends on search —
   search only filters what's shown *inside* an already-visible section. */
function updateLayout(){
  const d = peopleData[currentPerson.id];
  const hasLinks = d.links.length > 0;
  const hasNotes = d.notes.length > 0;
  const hasPdfs = d.pdfs.length > 0;

  document.getElementById('links-section').style.display = hasLinks ? '' : 'none';

  const splitSection = document.getElementById('split-section');
  const notesCol = document.getElementById('notes-col');
  const pdfsCol = document.getElementById('pdfs-col');
  const splitLine = document.getElementById('split-line');

  if(!hasNotes && !hasPdfs){
    splitSection.style.display = 'none';
  }else{
    splitSection.style.display = 'grid';
    notesCol.style.display = hasNotes ? '' : 'none';
    pdfsCol.style.display = hasPdfs ? '' : 'none';
    splitLine.style.display = (hasNotes && hasPdfs) ? '' : 'none';
    splitSection.style.gridTemplateColumns = (hasNotes && hasPdfs) ? '1fr 1.5px 1fr' : '1fr';
  }

  document.getElementById('content-divider').style.display = (hasLinks && (hasNotes || hasPdfs)) ? '' : 'none';
}

document.getElementById('detail-search').addEventListener('input', (e)=>{
  detailSearchQuery = e.target.value.trim().toLowerCase();
  renderLinks(); renderPdfs(); renderNotes();
});

function openDetail(person){
  currentPerson = person; paused = true;
  detailSearchQuery = '';
  document.getElementById('detail-search').value = '';
  mainView.style.display = 'none'; detailView.classList.add('open');
  document.getElementById('detail-photo').src = person.img;
  document.getElementById('detail-name').textContent = person.name;
  document.getElementById('detail-sub').textContent = countFor(person.id) + ' items filed';
  renderLinks(); renderPdfs(); renderNotes();
  updateLayout();
}
document.getElementById('back-btn').addEventListener('click', ()=>{
  detailView.classList.remove('open'); mainView.style.display='flex'; paused=false;
});



/* ---------- PDF viewer (pdf.js, canvas-rendered) ---------- */
if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
let pdfDoc = null, pdfPageNum = 1, pdfScale = 1.1, pdfRenderTask = null;

async function openPdfViewer(pdf){
  document.getElementById('pdf-modal-title').textContent = pdf.name;
  document.getElementById('pdf-modal-overlay').classList.add('open');
  const canvas = document.getElementById('pdf-canvas');
  const loading = document.getElementById('pdf-loading');
  const loadingText = document.getElementById('pdf-loading-text');
  const removeBtn = document.getElementById('pdf-remove-broken');
  canvas.style.display = 'none';
  loading.style.display = 'block';
  loadingText.textContent = 'Loading document…';
  removeBtn.style.display = 'none';
  pdfDoc = null; pdfPageNum = 1; pdfScale = 1.1;
  updatePdfZoomLabel();

  let fileUrl = pdf.url;
  if(!fileUrl && pdf.storage_path){
    fileUrl = sb.storage.from('pdfs').getPublicUrl(pdf.storage_path).data.publicUrl;
  }

  // Old data.json-era rows stored a relative path (e.g. "static/pdfs/name.pdf")
  // instead of a real URL — those files no longer exist anywhere.
  const isBrokenRelativePath = fileUrl && !/^https?:\/\//i.test(fileUrl);

  if(!fileUrl || isBrokenRelativePath){
    loading.style.display = 'block';
    loadingText.textContent = "This PDF's file is missing — it points to an old file path that no longer exists (from before this site used real file storage). You'll need to re-upload it via \"Add PDF\" if you still have the original file.";
    removeBtn.style.display = 'inline-block';
    removeBtn.onclick = ()=> removeBrokenPdf(pdf);
    return;
  }

  try{
    pdfDoc = await pdfjsLib.getDocument({ url: fileUrl }).promise;
    loading.style.display = 'none';
    canvas.style.display = 'block';
    renderPdfPage(1);
  }catch(e){
    loading.style.display = 'block';
    loadingText.textContent = "Couldn't load this PDF — the file may be missing or unreachable.";
    document.getElementById('pdf-page-info').textContent = '— / —';
    removeBtn.style.display = 'inline-block';
    removeBtn.onclick = ()=> removeBrokenPdf(pdf);
  }
}

async function removeBrokenPdf(pdf){
  const removeBtn = document.getElementById('pdf-remove-broken');
  removeBtn.disabled = true; removeBtn.textContent = 'Removing…';
  try{
    const { error } = await sb.from('pdfs').delete().eq('id', pdf.id);
    if(error) throw error;
    const arr = peopleData[currentPerson.id].pdfs;
    const idx = arr.findIndex(p=> p.id === pdf.id);
    if(idx > -1) arr.splice(idx, 1);
    renderPdfs();
    updateLayout();
    document.getElementById('pdf-modal-overlay').classList.remove('open');
  }catch(e){
    console.error('failed to remove broken pdf', e);
    removeBtn.disabled = false; removeBtn.textContent = 'Remove this broken entry';
    alert("Couldn't remove that entry — check your connection and try again.");
  }
}

async function renderPdfPage(num){
  if(!pdfDoc) return;
  if(pdfRenderTask){ try{ pdfRenderTask.cancel(); }catch(e){} }
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  pdfRenderTask = page.render({ canvasContext: ctx, viewport });
  try{ await pdfRenderTask.promise; }catch(e){ /* cancelled render, ignore */ }
  pdfPageNum = num;
  document.getElementById('pdf-page-info').textContent = pdfPageNum + ' / ' + pdfDoc.numPages;
  document.getElementById('pdf-prev').disabled = pdfPageNum <= 1;
  document.getElementById('pdf-next').disabled = pdfPageNum >= pdfDoc.numPages;
}
function updatePdfZoomLabel(){
  document.getElementById('pdf-zoom-level').textContent = Math.round(pdfScale / 1.1 * 100) + '%';
}

document.getElementById('pdf-prev').addEventListener('click', ()=>{ if(pdfDoc && pdfPageNum > 1) renderPdfPage(pdfPageNum - 1); });
document.getElementById('pdf-next').addEventListener('click', ()=>{ if(pdfDoc && pdfPageNum < pdfDoc.numPages) renderPdfPage(pdfPageNum + 1); });
document.getElementById('pdf-zoom-in').addEventListener('click', ()=>{
  if(!pdfDoc) return;
  pdfScale = Math.min(pdfScale + 0.2, 3.3); updatePdfZoomLabel(); renderPdfPage(pdfPageNum);
});
document.getElementById('pdf-zoom-out').addEventListener('click', ()=>{
  if(!pdfDoc) return;
  pdfScale = Math.max(pdfScale - 0.2, 0.5); updatePdfZoomLabel(); renderPdfPage(pdfPageNum);
});

document.getElementById('pdf-modal-close').addEventListener('click', closePdfViewer);
document.getElementById('pdf-modal-overlay').addEventListener('click', (e)=>{ if(e.target.id==='pdf-modal-overlay') closePdfViewer(); });
function closePdfViewer(){
  document.getElementById('pdf-modal-overlay').classList.remove('open');
  if(pdfRenderTask){ try{ pdfRenderTask.cancel(); }catch(e){} }
  pdfDoc = null;
}

/* ---------- reading view ---------- */
function openReadingView(note){
  document.getElementById('reading-title').textContent = note.title;
  document.getElementById('reading-meta').textContent = currentPerson.name + ' · Note';
  document.getElementById('reading-body').innerHTML = renderMarkdown(note.body);
  document.getElementById('reading-overlay').classList.add('open');
}
document.getElementById('reading-close').addEventListener('click', ()=> document.getElementById('reading-overlay').classList.remove('open'));
document.getElementById('reading-overlay').addEventListener('click', (e)=>{ if(e.target.id==='reading-overlay') e.currentTarget.classList.remove('open'); });

/* ---------- add person modal ---------- */
const addPersonOverlay = document.getElementById('add-person-overlay');
let uploadedPhotoFile = null;
let editingPersonId = null; // null = adding a new person; set = editing an existing one

function openAddPersonModal(){
  editingPersonId = null;
  document.getElementById('ap-heading').textContent = 'Add someone new';
  document.getElementById('ap-submit').textContent = 'Add';
  document.getElementById('ap-name').value='';
  document.getElementById('ap-photo-url').value='';
  document.getElementById('ap-photo-file').value='';
  document.getElementById('ap-preview').style.display='none';
  document.getElementById('ap-upload-label').textContent='Click to upload a photo';
  uploadedPhotoFile = null;
  addPersonOverlay.classList.add('open');
}
function openEditPersonModal(person){
  editingPersonId = person.id;
  document.getElementById('ap-heading').textContent = 'Edit ' + person.name;
  document.getElementById('ap-submit').textContent = 'Save';
  document.getElementById('ap-name').value = person.name;
  document.getElementById('ap-photo-url').value = '';
  document.getElementById('ap-photo-file').value = '';
  document.getElementById('ap-preview').src = person.img;
  document.getElementById('ap-preview').style.display = 'inline-block';
  document.getElementById('ap-upload-label').textContent = 'Click to upload a new photo';
  uploadedPhotoFile = null;
  addPersonOverlay.classList.add('open');
}
document.getElementById('btn-edit-person').addEventListener('click', ()=>{
  if(currentPerson) openEditPersonModal(currentPerson);
});
document.getElementById('ap-upload-zone').addEventListener('click', ()=> document.getElementById('ap-photo-file').click());
document.getElementById('ap-photo-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  const label = document.getElementById('ap-upload-label');
  const thumb = document.getElementById('ap-preview');
  if(!file) return;
  if(file.size > MAX_PHOTO_BYTES){ label.textContent = 'Too large — try a smaller image (max 1.5MB)'; return; }
  uploadedPhotoFile = file;
  const reader = new FileReader();
  reader.onload = ()=>{
    thumb.src = reader.result; thumb.style.display='inline-block';
    label.textContent = file.name;
    document.getElementById('ap-photo-url').value = '';
  };
  reader.readAsDataURL(file);
});
document.getElementById('ap-photo-url').addEventListener('input', (e)=>{
  const url = e.target.value.trim();
  const thumb = document.getElementById('ap-preview');
  if(url){ uploadedPhotoFile = null; thumb.src = url; thumb.style.display='inline-block'; }
  else if(!uploadedPhotoFile){ thumb.style.display='none'; }
});
document.getElementById('ap-cancel').addEventListener('click', ()=> addPersonOverlay.classList.remove('open'));
addPersonOverlay.addEventListener('click', (e)=>{ if(e.target.id==='add-person-overlay') addPersonOverlay.classList.remove('open'); });

async function submitPersonForm(){
  const name = document.getElementById('ap-name').value.trim();
  if(!name) return;
  const submitBtn = document.getElementById('ap-submit');
  const wasEditing = !!editingPersonId;
  submitBtn.disabled = true; submitBtn.textContent = wasEditing ? 'Saving…' : 'Adding…';
  try{
    let photo = document.getElementById('ap-photo-url').value.trim() || null;
    if(uploadedPhotoFile){
      const { publicUrl } = await uploadToBucket('avatars', uploadedPhotoFile, 'avatars');
      photo = publicUrl;
    }
    if(!photo) photo = wasEditing ? currentPerson.img : makeInitialsAvatar(name);

    if(wasEditing){
      const { error } = await sb.from('people').update({ name, img: photo }).eq('id', editingPersonId);
      if(error) throw error;
      const p = people.find(p=> p.id === editingPersonId);
      if(p){ p.name = name; p.img = photo; }
      if(currentPerson && currentPerson.id === editingPersonId){
        currentPerson.name = name; currentPerson.img = photo;
        document.getElementById('detail-photo').src = photo;
        document.getElementById('detail-name').textContent = name;
      }
      rebuildBelt();
    }else{
      const { data: newPerson, error } = await sb.from('people')
        .insert({ name, img: photo }).select().single();
      if(error) throw error;
      people.push({ id:newPerson.id, name, img:photo, count:0 });
      peopleData[newPerson.id] = {links:[], pdfs:[], notes:[]};
      rebuildBelt();
    }
    addPersonOverlay.classList.remove('open');
  }catch(e){
    console.error('save person failed', e);
    alert("Couldn't save — check your connection and Supabase setup.");
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = wasEditing ? 'Save' : 'Add';
  }
}
document.getElementById('ap-submit').addEventListener('click', submitPersonForm);
enterSubmits(document.getElementById('ap-name'), submitPersonForm);
enterSubmits(document.getElementById('ap-photo-url'), submitPersonForm);

/* ---------- add content modal ---------- */
const addContentOverlay = document.getElementById('add-content-overlay');
let activeContentType = 'link';
let selectedPdfFile = null;
const MAX_PDF_BYTES = 3.5 * 1024 * 1024;
function fmtSize(bytes){ if(bytes < 1024*1024) return Math.round(bytes/1024) + ' KB'; return (bytes/(1024*1024)).toFixed(1) + ' MB'; }

document.getElementById('ac-pdf-upload-zone').addEventListener('click', ()=> document.getElementById('ac-pdf-file').click());
document.getElementById('ac-pdf-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  const label = document.getElementById('ac-pdf-upload-label');
  if(!file) return;
  if(file.type !== 'application/pdf'){ label.textContent = 'Please choose a PDF file.'; selectedPdfFile = null; e.target.value=''; return; }
  if(file.size > MAX_PDF_BYTES){ label.textContent = `Too large (${fmtSize(file.size)}) — max ~3.5MB.`; selectedPdfFile = null; e.target.value=''; return; }
  selectedPdfFile = file;
  label.textContent = file.name + ' · ' + fmtSize(file.size);
});

/* custom dropdown for link type */
let selectedLinkType = 'Video';
const typeSelect = document.getElementById('ac-type-select');
const typeTrigger = document.getElementById('ac-type-trigger');
const typeMenu = document.getElementById('ac-type-menu');
typeTrigger.addEventListener('click', ()=> typeSelect.classList.toggle('open'));
typeMenu.querySelectorAll('.custom-select-option').forEach(opt=>{
  opt.addEventListener('click', ()=>{
    selectedLinkType = opt.dataset.value;
    document.getElementById('ac-type-label').textContent = selectedLinkType;
    typeMenu.querySelectorAll('.custom-select-option').forEach(o=> o.classList.remove('selected'));
    opt.classList.add('selected');
    typeSelect.classList.remove('open');
  });
});
document.addEventListener('click', (e)=>{ if(!typeSelect.contains(e.target)) typeSelect.classList.remove('open'); });

function openContentModal(type){
  activeContentType = type;
  document.getElementById('ac-link-fields').style.display = type==='link' ? 'block' : 'none';
  document.getElementById('ac-text-fields').style.display = type==='text' ? 'block' : 'none';
  document.getElementById('ac-pdf-fields').style.display = type==='pdf' ? 'block' : 'none';
  document.getElementById('ac-heading').textContent = type==='link' ? 'Add a link' : type==='text' ? 'Add text' : 'Add a PDF';
  ['ac-link-title','ac-link-url','ac-text-title','ac-text-body'].forEach(id=> document.getElementById(id).value='');
  document.getElementById('ac-pdf-file').value = '';
  document.getElementById('ac-pdf-upload-label').textContent = 'Click to choose a PDF';
  selectedPdfFile = null;
  selectedLinkType = 'Video';
  document.getElementById('ac-type-label').textContent = 'Video';
  typeMenu.querySelectorAll('.custom-select-option').forEach(o=> o.classList.toggle('selected', o.dataset.value==='Video'));
  addContentOverlay.classList.add('open');
}
document.getElementById('btn-add-link').addEventListener('click', ()=> openContentModal('link'));
document.getElementById('btn-add-text').addEventListener('click', ()=> openContentModal('text'));
document.getElementById('btn-add-pdf').addEventListener('click', ()=> openContentModal('pdf'));
document.getElementById('ac-cancel').addEventListener('click', ()=> addContentOverlay.classList.remove('open'));
addContentOverlay.addEventListener('click', (e)=>{ if(e.target.id==='add-content-overlay') addContentOverlay.classList.remove('open'); });
async function submitContentForm(){
  if(!currentPerson) return;
  const data = peopleData[currentPerson.id];
  const submitBtn = document.getElementById('ac-submit');
  submitBtn.disabled = true; submitBtn.textContent = 'Adding…';
  try{
    if(activeContentType==='link'){
      const title = document.getElementById('ac-link-title').value.trim(); if(!title){ submitBtn.disabled=false; submitBtn.textContent='Add'; return; }
      const url = document.getElementById('ac-link-url').value.trim();
      const row = { person_id: currentPerson.id, badge: selectedLinkType, title, meta: 'filed just now', url: url || '#' };
      const { data: inserted, error } = await sb.from('links').insert(row).select().single();
      if(error) throw error;
      data.links.unshift(inserted);
      renderLinks();
    } else if(activeContentType==='text'){
      const title = document.getElementById('ac-text-title').value.trim() || 'Untitled';
      const body = document.getElementById('ac-text-body').value.trim(); if(!body){ submitBtn.disabled=false; submitBtn.textContent='Add'; return; }
      const row = { person_id: currentPerson.id, title, body };
      const { data: inserted, error } = await sb.from('notes').insert(row).select().single();
      if(error) throw error;
      data.notes.unshift(inserted);
      renderNotes();
    } else if(activeContentType==='pdf'){
      if(!selectedPdfFile){ submitBtn.disabled=false; submitBtn.textContent='Add'; return; }
      const { path } = await uploadToBucket('pdfs', selectedPdfFile, currentPerson.id);
      const row = { person_id: currentPerson.id, name: selectedPdfFile.name, size: fmtSize(selectedPdfFile.size), storage_path: path };
      const { data: inserted, error } = await sb.from('pdfs').insert(row).select().single();
      if(error) throw error;
      data.pdfs.unshift(inserted);
      renderPdfs();
    }
    currentPerson.count = countFor(currentPerson.id);
    updateLayout();
    document.getElementById('detail-sub').textContent = currentPerson.count + ' items filed';
    addContentOverlay.classList.remove('open');
  }catch(e){
    console.error('add content failed', e);
    document.getElementById('ac-pdf-upload-label').textContent = 'Something went wrong — check your connection.';
    alert("Couldn't save that — check your connection and Supabase setup.");
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = 'Add';
  }
}
document.getElementById('ac-submit').addEventListener('click', submitContentForm);
enterSubmits(document.getElementById('ac-link-title'), submitContentForm);
enterSubmits(document.getElementById('ac-link-url'), submitContentForm);
enterSubmits(document.getElementById('ac-text-title'), submitContentForm);
// Note: ac-text-body is a textarea — Enter there creates a new line as expected,
// it does not submit the form (use Cmd/Ctrl+Enter for that instead).
document.getElementById('ac-text-body').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); submitContentForm(); }
});

/* ---------- init ---------- */
(async function init(){
  await loadState();
  rebuildBelt();
  holdUntil = performance.now() + HOLD_MS;
  requestAnimationFrame(tick);
})();