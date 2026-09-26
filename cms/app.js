const $ = s => document.querySelector(s);
const state = { files: [], filtered: [] };

async function api(path, options = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2600)}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function formatBytes(n){if(!n)return '0 B';const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<3){n/=1024;i++}return `${n.toFixed(n<10&&i?1:0)} ${u[i]}`}
function fileUrl(f){return f.url}

async function boot(){
  try{const s=await api('/api/session'); if(s.ok) showApp(); else showLogin()}catch{showLogin()}
}
function showLogin(){$('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden')}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');loadImages()}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{await api('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:$('#password').value})});showApp()}catch(err){$('#loginError').textContent=err.message}});
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});showLogin()};
$('#refreshBtn').onclick=loadImages;
$('#uploadBtn').onclick=()=>document.querySelector('[data-view="upload"]').click();

document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));b.classList.add('active');const v=b.dataset.view;$('#imagesView').classList.toggle('hidden',v!=='images');$('#uploadView').classList.toggle('hidden',v!=='upload');$('#pageTitle').textContent=v==='images'?'Images':'Upload Image';if(v==='upload')resetQueue()});
$('#search').oninput=render;
$('#folderFilter').onchange=render;

async function loadImages(){
  $('#grid').innerHTML='<div class="stats">Loading images…</div>';
  try{const data=await api('/api/images');state.files=data.files||[];buildFolders();render();}catch(err){$('#grid').innerHTML=`<div class="stats">${esc(err.message)}</div>`}}
function buildFolders(){const folders=[...new Set(state.files.map(f=>f.folder).filter(Boolean))].sort();$('#folderFilter').innerHTML='<option value="">All folders</option>'+folders.map(f=>`<option>${esc(f)}</option>`).join('');$('#uploadFolder').innerHTML='<option value="">assets/images</option>'+folders.map(f=>`<option value="${esc(f)}">assets/images/${esc(f)}</option>`).join('')}
function render(){const q=$('#search').value.trim().toLowerCase(),folder=$('#folderFilter').value;state.filtered=state.files.filter(f=>(!q||f.path.toLowerCase().includes(q))&&(!folder||f.folder===folder));$('#stats').textContent=`${state.filtered.length} image${state.filtered.length===1?'':'s'} · ${formatBytes(state.filtered.reduce((a,f)=>a+f.size,0))}`;if(!state.filtered.length){$('#grid').innerHTML='<div class="stats">No images found.</div>';return}$('#grid').innerHTML=state.filtered.map((f,i)=>`<article class="image-card"><div class="thumb"><img loading="lazy" src="${esc(fileUrl(f))}" alt=""></div><div class="card-body"><div class="filename" title="${esc(f.name)}">${esc(f.name)}</div><div class="path" title="${esc(f.path)}">${esc(f.path)}</div><div class="actions"><button onclick="preview(${i})">Preview</button><button onclick="replaceImage(${i})">Replace</button><button onclick="renameImage(${i})">Rename</button><button class="delete" onclick="deleteImage(${i})">Delete</button></div></div></article>`).join('')}

window.preview=i=>{const f=state.filtered[i];$('#modalBody').innerHTML=`<h3>${esc(f.name)}</h3><img class="edit-preview" src="${esc(f.url)}"><div class="path">${esc(f.path)} · ${formatBytes(f.size)}</div><div class="modal-actions"><button class="primary" onclick="copyUrl('${esc(f.url)}')">Copy URL</button></div>`;openModal()}
window.copyUrl=async url=>{await navigator.clipboard.writeText(url);toast('Image URL copied')}
window.deleteImage=async i=>{const f=state.filtered[i];if(!confirm(`Delete “${f.name}”?\n\nThis creates a GitHub commit and removes the image from the repository.`))return;try{await api('/api/images/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:f.path,sha:f.sha})});toast('Image deleted');loadImages()}catch(e){toast(e.message)}};
window.renameImage=async i=>{const f=state.filtered[i];const name=prompt('New filename:',f.name);if(!name||name===f.name)return;const clean=name.trim().replace(/[^a-zA-Z0-9._-]/g,'-');const folder=f.folder?`assets/images/${f.folder}/`:'assets/images/';const to=folder+clean;if(!isImageName(clean)){toast('Use an image extension');return}try{await api('/api/images/rename',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:f.path,to,sha:f.sha})});toast('Image renamed');loadImages()}catch(e){toast(e.message)}};
window.replaceImage=i=>{const f=state.filtered[i];const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=()=>input.files[0]&&processFiles(input.files,[f]);input.click()};
function isImageName(n){return /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico)$/i.test(n)}

const dz=$('#dropZone'),fi=$('#fileInput');dz.onclick=e=>{if(e.target!==fi)fi.click()};fi.onchange=()=>processFiles(fi.files);['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.add('drag')}));['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.remove('drag')}));dz.addEventListener('drop',e=>processFiles(e.dataTransfer.files));
function resetQueue(){$('#uploadQueue').innerHTML=''}
async function processFiles(fileList, replaceTargets=[]){const files=[...fileList];if(!files.length)return;$('#uploadQueue').innerHTML='';for(const file of files){if(file.size>8*1024*1024){toast(`${file.name}: over 8 MB`);continue}const item=document.createElement('div');item.className='queue-item';item.innerHTML=`<img src="${URL.createObjectURL(file)}"><div class="qinfo"><b>${esc(file.name)}</b><div class="path">${formatBytes(file.size)}</div><div class="progress"><i></i></div></div><span class="qstatus">Waiting</span>`;$('#uploadQueue').appendChild(item);const bar=item.querySelector('i'),status=item.querySelector('.qstatus');try{let out=await prepareImage(file);let path;if(replaceTargets.length){path=replaceTargets[0].path}else{const folder=$('#uploadFolder').value;let name=($('#filenamePrefix').value.trim()?$('#filenamePrefix').value.trim()+'-':'')+out.name;path=(folder?`assets/images/${folder}/`:'assets/images/')+name}status.textContent='Uploading…';bar.style.width='40%';await api('/api/images/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path,content:out.dataUrl})});bar.style.width='100%';status.textContent='Done';toast(replaceTargets.length?'Image replaced':'Image uploaded');if(replaceTargets.length)break}catch(e){status.textContent=e.message;status.style.color='#dc2626'}}if(replaceTargets.length){loadImages()}}

async function prepareImage(file){
  // Browser-side compression for raster images; SVG is uploaded unchanged.
  if(file.type==='image/svg+xml')return {name:file.name,dataUrl:await readDataUrl(file)};
  const bitmap=await createImageBitmap(file);const max=2400;const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(bitmap,0,0,w,h);const type=file.type==='image/png'?'image/png':'image/webp';const blob=await new Promise(r=>c.toBlob(r,type,.88));return {name: file.name.replace(/\.[^.]+$/,'')+(type==='image/webp'?'.webp':'.png'),dataUrl:await readDataUrl(blob)}
}
function readDataUrl(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob)})}

function openModal(){$('#modal').classList.remove('hidden')}function closeModal(){$('#modal').classList.add('hidden')}$('#modalClose').onclick=closeModal;$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
boot();
