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

/* ---------- data ---------- */
let people = [];
let peopleData = {};
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;

function makeInitialsAvatar(name){
  const initial = (name.trim()[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="300" height="300" fill="#D4A373"/>
    <text x="50%" y="53%" font-family="Georgia, serif" font-size="120" fill="#FFFDF8" text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

async function loadState(){
  try{
    const p = await window.storage.get('carousel-people', false);
    const c = await window.storage.get('carousel-content', false);
    people = JSON.parse(p.value);
    peopleData = JSON.parse(c.value);
  }catch(e){
    people = []; peopleData = {};
    try{
      const res = await fetch('data.json');
      const json = await res.json();
      if(json.people && json.people.length){
        json.people.forEach(p=>{
          const links = (p.links||[]).map(l=>({badge:l.type, title:l.title, meta:l.meta||'', url:l.url}));
          const pdfs = (p.pdfs||[]).map(d=>({name:d.title, size:d.size||'', file:d.file}));
          const notes = (p.notes||[]).map(n=>({title:n.title, body:n.body}));
          people.push({
            id:'p'+p.id, name:p.name, img: p.photo || makeInitialsAvatar(p.name),
            count: links.length + pdfs.length + notes.length
          });
          peopleData[p.name] = {links, pdfs, notes};
        });
      }
    }catch(err){
      // data.json not reachable (likely opened via file:// instead of a local server) — start empty
    }
    await saveState();
  }
}
async function saveState(){
  try{
    await window.storage.set('carousel-people', JSON.stringify(people), false);
    await window.storage.set('carousel-content', JSON.stringify(peopleData), false);
  }catch(e){ console.error('save failed', e); }
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
  frontName.textContent = people[frontIdx] ? people[frontIdx].name : 'Add someone new';
  frontCount.textContent = people[frontIdx] ? (people[frontIdx].count + ' filed') : 'tap to add a person';
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

function renderLinks(){
  const arr = peopleData[currentPerson.name].links;
  const el = document.getElementById('detail-links');
  el.innerHTML = arr.length ? arr.map((l,i)=>`
    <div class="link-item type-${l.badge.toLowerCase()}" data-link="${i}">
      <span class="link-badge type-${l.badge.toLowerCase()}">${l.badge}</span>
      <div class="link-title">${l.title}</div>
      <div class="link-meta">${l.meta}</div>
    </div>`).join('') : `<div class="empty-group">No links yet.</div>`;
  el.querySelectorAll('.link-item').forEach(item=> item.addEventListener('click', ()=>{
    const link = arr[parseInt(item.dataset.link)];
    if(link.url) window.open(link.url, '_blank', 'noopener');
  }));
}
function renderPdfs(){
  const arr = peopleData[currentPerson.name].pdfs;
  const el = document.getElementById('detail-pdfs');
  el.innerHTML = arr.length ? arr.map((p,i)=>`
    <div class="pdf-item" data-pdf="${i}">
      <span class="pdf-icon">📄</span>
      <div><div class="pdf-name">${p.name}</div><div class="pdf-size">${p.size}</div></div>
    </div>`).join('') : `<div class="empty-group">No PDFs yet.</div>`;
  el.querySelectorAll('.pdf-item').forEach(item=> item.addEventListener('click', ()=> openPdfViewer(arr[parseInt(item.dataset.pdf)])));
}
function renderNotes(){
  const arr = peopleData[currentPerson.name].notes;
  const el = document.getElementById('detail-notes');
  el.innerHTML = arr.length ? arr.map((n,i)=>`
    <div class="note-item" data-note="${i}">
      <div class="note-title">${n.title}</div>
      <div class="note-snippet">${n.body.replace(/[#>*_`\-]/g,'').slice(0,110)}</div>
      <div class="note-open-hint">Open reading view →</div>
    </div>`).join('') : `<div class="empty-group">No text saved yet.</div>`;
  el.querySelectorAll('.note-item').forEach(item=> item.addEventListener('click', ()=> openReadingView(arr[parseInt(item.dataset.note)])));
}

function openDetail(person){
  currentPerson = person; paused = true;
  mainView.style.display = 'none'; detailView.classList.add('open');
  document.getElementById('detail-photo').src = person.img;
  document.getElementById('detail-name').textContent = person.name;
  document.getElementById('detail-sub').textContent = person.count + ' items filed';
  renderLinks(); renderPdfs(); renderNotes();
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
  canvas.style.display = 'none';
  loading.style.display = 'block';
  loading.textContent = 'Loading document…';
  pdfDoc = null; pdfPageNum = 1; pdfScale = 1.1;
  updatePdfZoomLabel();

  try{
    let source;
    if(pdf.file){
      source = { url: pdf.file };
    } else if(pdf.id){
      const data = await window.storage.get('pdf:' + pdf.id, false);
      const byteChars = atob(data.value);
      const byteNumbers = new Uint8Array(byteChars.length);
      for(let i=0;i<byteChars.length;i++){ byteNumbers[i] = byteChars.charCodeAt(i); }
      source = { data: byteNumbers };
    } else {
      source = { url: pdf.url };
    }
    pdfDoc = await pdfjsLib.getDocument(source).promise;
    loading.style.display = 'none';
    canvas.style.display = 'block';
    renderPdfPage(1);
  }catch(e){
    loading.style.display = 'block';
    loading.textContent = "Couldn't load this PDF.";
    document.getElementById('pdf-page-info').textContent = '— / —';
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
let uploadedPhotoData = null;
function openAddPersonModal(){
  document.getElementById('ap-name').value='';
  document.getElementById('ap-photo-url').value='';
  document.getElementById('ap-photo-file').value='';
  document.getElementById('ap-preview').style.display='none';
  document.getElementById('ap-upload-label').textContent='Click to upload a photo';
  uploadedPhotoData = null;
  addPersonOverlay.classList.add('open');
}
document.getElementById('ap-upload-zone').addEventListener('click', ()=> document.getElementById('ap-photo-file').click());
document.getElementById('ap-photo-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  const label = document.getElementById('ap-upload-label');
  const thumb = document.getElementById('ap-preview');
  if(!file) return;
  if(file.size > MAX_PHOTO_BYTES){ label.textContent = 'Too large — try a smaller image (max 1.5MB)'; return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    uploadedPhotoData = reader.result;
    thumb.src = uploadedPhotoData; thumb.style.display='inline-block';
    label.textContent = file.name;
    document.getElementById('ap-photo-url').value = '';
  };
  reader.readAsDataURL(file);
});
document.getElementById('ap-photo-url').addEventListener('input', (e)=>{
  const url = e.target.value.trim();
  const thumb = document.getElementById('ap-preview');
  if(url){ uploadedPhotoData = null; thumb.src = url; thumb.style.display='inline-block'; }
  else if(!uploadedPhotoData){ thumb.style.display='none'; }
});
document.getElementById('ap-cancel').addEventListener('click', ()=> addPersonOverlay.classList.remove('open'));
addPersonOverlay.addEventListener('click', (e)=>{ if(e.target.id==='add-person-overlay') addPersonOverlay.classList.remove('open'); });
document.getElementById('ap-submit').addEventListener('click', async ()=>{
  const name = document.getElementById('ap-name').value.trim();
  if(!name) return;
  let photo = uploadedPhotoData || document.getElementById('ap-photo-url').value.trim();
  if(!photo){ photo = makeInitialsAvatar(name); }
  const id = 'p' + Date.now();
  const newPerson = {id, name, img: photo, count: 0};
  people.push(newPerson);
  peopleData[name] = {links:[], pdfs:[], notes:[]};
  rebuildBelt();
  await saveState();
  addPersonOverlay.classList.remove('open');
});

/* ---------- add content modal ---------- */
const addContentOverlay = document.getElementById('add-content-overlay');
let activeContentType = 'link';
let selectedPdfFile = null;
const MAX_PDF_BYTES = 3.5 * 1024 * 1024;
function fmtSize(bytes){ if(bytes < 1024*1024) return Math.round(bytes/1024) + ' KB'; return (bytes/(1024*1024)).toFixed(1) + ' MB'; }
function readFileAsBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result.split(',')[1]);
    reader.onerror = ()=> reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

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
document.getElementById('ac-submit').addEventListener('click', async ()=>{
  if(!currentPerson) return;
  const data = peopleData[currentPerson.name];
  const status = document.getElementById('ac-heading');
  if(activeContentType==='link'){
    const title = document.getElementById('ac-link-title').value.trim(); if(!title) return;
    const url = document.getElementById('ac-link-url').value.trim();
    data.links.unshift({badge:selectedLinkType, title, meta:'filed just now', url: url || '#'});
    renderLinks();
  } else if(activeContentType==='text'){
    const title = document.getElementById('ac-text-title').value.trim() || 'Untitled';
    const body = document.getElementById('ac-text-body').value.trim(); if(!body) return;
    data.notes.unshift({title, body});
    renderNotes();
  } else if(activeContentType==='pdf'){
    if(!selectedPdfFile) return;
    const id = 'pdf' + Date.now();
    try{
      const base64 = await readFileAsBase64(selectedPdfFile);
      await window.storage.set('pdf:' + id, base64, false);
    }catch(e){ document.getElementById('ac-pdf-upload-label').textContent = 'Could not read the file — try again.'; return; }
    data.pdfs.unshift({name: selectedPdfFile.name, size: fmtSize(selectedPdfFile.size), id});
    renderPdfs();
  }
  currentPerson.count++;
  document.getElementById('detail-sub').textContent = currentPerson.count + ' items filed';
  await saveState();
  addContentOverlay.classList.remove('open');
});

/* ---------- init ---------- */
(async function init(){
  await loadState();
  rebuildBelt();
  holdUntil = performance.now() + HOLD_MS;
  requestAnimationFrame(tick);
})();