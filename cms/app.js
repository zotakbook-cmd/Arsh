const $ = s => document.querySelector(s);

const state = {
  files: [],
  filtered: [],
  loading: false
};

/*
 * IMPORTANT:
 * /api/images is the normal image endpoint.
 * At the moment the Worker endpoint may return only one image even though
 * /api/github-images-debug returns all three GitHub directory entries.
 *
 * Therefore the frontend has a safe fallback:
 * 1. Try /api/images.
 * 2. If the returned list is incomplete, call /api/github-images-debug.
 * 3. Build public raw GitHub URLs from the returned paths.
 *
 * This does NOT expose GITHUB_TOKEN or any secret.
 */

const GITHUB_PUBLIC = {
  owner: 'zotakbook-cmd',
  repo: 'Arsh',
  branch: 'main'
};

async function api(path, options = {}) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      'cache-control': 'no-cache',
      ...(options.headers || {})
    }
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(data.error || `Request failed (${r.status})`);
  }

  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
  }[m]));
}

function formatBytes(n) {
  n = Number(n) || 0;
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB'];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

function fileUrl(f) {
  return f && f.url ? f.url : '';
}

function githubRawUrl(path) {
  const encoded = String(path || '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  return `https://raw.githubusercontent.com/${encodeURIComponent(GITHUB_PUBLIC.owner)}/${encodeURIComponent(GITHUB_PUBLIC.repo)}/${encodeURIComponent(GITHUB_PUBLIC.branch)}/${encoded}`;
}

function normalizeImage(item) {
  if (!item || typeof item !== 'object') return null;

  const path = String(item.path || '').trim();
  if (!path || !isImageName(path)) return null;

  const parts = path.split('/');

  return {
    path,
    name: String(item.name || parts[parts.length - 1]),
    folder: item.folder != null
      ? String(item.folder)
      : parts.slice(2, -1).join('/'),
    sha: String(item.sha || ''),
    size: Number(item.size || 0),
    url: String(item.url || githubRawUrl(path))
  };
}

function dedupeFiles(files) {
  const map = new Map();

  for (const raw of files || []) {
    const f = normalizeImage(raw);
    if (!f) continue;
    map.set(f.path, f);
  }

  return [...map.values()].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
}

/*
 * Frontend fallback to the diagnostic endpoint.
 * That endpoint has already been verified to return:
 * banner-mobile.webp
 * banner-pc.webp
 * logo.webp
 */
async function loadImagesFromDebug() {
  const data = await api('/api/github-images-debug');

  if (!Array.isArray(data.items)) {
    throw new Error('GitHub image list is invalid.');
  }

  return dedupeFiles(data.items);
}

async function loadImages() {
  if (state.loading) return;

  state.loading = true;

  $('#grid').innerHTML = '<div class="stats loading-state">Loading images…</div>';
  $('#stats').textContent = '';

  try {
    let normalData = null;

    try {
      normalData = await api('/api/images');
    } catch (normalError) {
      console.warn('[Arsh CMS] /api/images failed:', normalError);
    }

    let normalFiles = dedupeFiles(
      normalData && Array.isArray(normalData.files)
        ? normalData.files
        : []
    );

    /*
     * Always ask debug endpoint when the normal endpoint has fewer than
     * the expected root images. This is the important frontend fix.
     *
     * It also handles the current Worker situation where /api/images
     * returns only logo.webp while the diagnostic endpoint returns all 3.
     */
    if (normalFiles.length < 3) {
      try {
        const debugFiles = await loadImagesFromDebug();

        if (debugFiles.length > normalFiles.length) {
          normalFiles = dedupeFiles([
            ...normalFiles,
            ...debugFiles
          ]);
        }
      } catch (debugError) {
        console.warn('[Arsh CMS] Debug image fallback failed:', debugError);
      }
    }

    state.files = normalFiles;

    buildFolders();
    render();

    if (!state.files.length) {
      $('#grid').innerHTML =
        '<div class="stats">No images found.</div>';
    }

  } catch (err) {
    console.error('[Arsh CMS] Image loading error:', err);

    $('#stats').textContent = '';
    $('#grid').innerHTML =
      `<div class="stats error-box">${esc(err.message)}</div>`;
  } finally {
    state.loading = false;
  }
}

function buildFolders() {
  const folders = [
    ...new Set(
      state.files
        .map(f => f.folder)
        .filter(Boolean)
    )
  ].sort();

  const currentFolder = $('#folderFilter').value;

  $('#folderFilter').innerHTML =
    '<option value="">All folders</option>' +
    folders.map(f =>
      `<option value="${esc(f)}">${esc(f)}</option>`
    ).join('');

  if (folders.includes(currentFolder)) {
    $('#folderFilter').value = currentFolder;
  }

  $('#uploadFolder').innerHTML =
    '<option value="">assets/images</option>' +
    folders.map(f =>
      `<option value="${esc(f)}">assets/images/${esc(f)}</option>`
    ).join('');
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const folder = $('#folderFilter').value;

  state.filtered = state.files.filter(f =>
    (!q || `${f.name} ${f.path}`.toLowerCase().includes(q)) &&
    (!folder || f.folder === folder)
  );

  const totalSize = state.filtered.reduce(
    (a, f) => a + (Number(f.size) || 0),
    0
  );

  $('#stats').textContent =
    `${state.filtered.length} image${state.filtered.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}`;

  if (!state.filtered.length) {
    $('#grid').innerHTML =
      '<div class="stats">No images found.</div>';
    return;
  }

  $('#grid').innerHTML = state.filtered.map((f, i) => `
    <article class="image-card">
      <div class="thumb">
        <img
          loading="lazy"
          src="${esc(fileUrl(f))}"
          alt="${esc(f.name)}"
          onerror="this.classList.add('image-error')"
        >
      </div>

      <div class="card-body">
        <div class="filename" title="${esc(f.name)}">
          ${esc(f.name)}
        </div>

        <div class="path" title="${esc(f.path)}">
          ${esc(f.path)}
        </div>

        <div class="actions">
          <button onclick="preview(${i})">Preview</button>
          <button onclick="replaceImage(${i})">Replace</button>
          <button onclick="renameImage(${i})">Rename</button>
          <button class="delete" onclick="deleteImage(${i})">Delete</button>
        </div>
      </div>
    </article>
  `).join('');
}

window.preview = i => {
  const f = state.filtered[i];
  if (!f) return;

  $('#modalBody').innerHTML = `
    <h3>${esc(f.name)}</h3>
    <img
      class="edit-preview"
      src="${esc(f.url)}"
      alt="${esc(f.name)}"
    >
    <div class="path">
      ${esc(f.path)} · ${formatBytes(f.size)}
    </div>

    <div class="modal-actions">
      <button class="primary" onclick="copyUrl(${JSON.stringify(f.url)})">
        Copy URL
      </button>
    </div>
  `;

  openModal();
};

window.copyUrl = async url => {
  try {
    await navigator.clipboard.writeText(url);
    toast('Image URL copied');
  } catch {
    toast('Unable to copy URL');
  }
};

window.deleteImage = async i => {
  const f = state.filtered[i];
  if (!f) return;

  if (!confirm(
    `Delete “${f.name}”?\\n\\n` +
    `This creates a GitHub commit and removes the image from the repository.`
  )) return;

  try {
    await api('/api/images/delete', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        path: f.path,
        sha: f.sha
      })
    });

    toast('Image deleted');
    await loadImages();

  } catch (e) {
    toast(e.message);
  }
};

window.renameImage = async i => {
  const f = state.filtered[i];
  if (!f) return;

  const name = prompt('New filename:', f.name);
  if (!name || name === f.name) return;

  const clean = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-');

  if (!isImageName(clean)) {
    toast('Use an image extension');
    return;
  }

  const folder = f.folder
    ? `assets/images/${f.folder}/`
    : 'assets/images/';

  const to = folder + clean;

  try {
    await api('/api/images/rename', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        from: f.path,
        to,
        sha: f.sha
      })
    });

    toast('Image renamed');
    await loadImages();

  } catch (e) {
    toast(e.message);
  }
};

window.replaceImage = i => {
  const f = state.filtered[i];
  if (!f) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';

  input.onchange = () => {
    if (input.files[0]) {
      processFiles(input.files, [f]);
    }
  };

  input.click();
};

function isImageName(n) {
  return /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico)$/i.test(
    String(n || '')
  );
}

const dz = $('#dropZone');
const fi = $('#fileInput');

dz.onclick = e => {
  if (e.target !== fi) fi.click();
};

fi.onchange = () => processFiles(fi.files);

['dragenter','dragover'].forEach(x =>
  dz.addEventListener(x, e => {
    e.preventDefault();
    dz.classList.add('drag');
  })
);

['dragleave','drop'].forEach(x =>
  dz.addEventListener(x, e => {
    e.preventDefault();
    dz.classList.remove('drag');
  })
);

dz.addEventListener('drop', e =>
  processFiles(e.dataTransfer.files)
);

function resetQueue() {
  $('#uploadQueue').innerHTML = '';
}

async function processFiles(fileList, replaceTargets = []) {
  const files = [...fileList];

  if (!files.length) return;

  $('#uploadQueue').innerHTML = '';

  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) {
      toast(`${file.name}: over 8 MB`);
      continue;
    }

    const item = document.createElement('div');
    item.className = 'queue-item';

    item.innerHTML = `
      <img src="${URL.createObjectURL(file)}">
      <div class="qinfo">
        <b>${esc(file.name)}</b>
        <div class="path">${formatBytes(file.size)}</div>
        <div class="progress"><i></i></div>
      </div>
      <span class="qstatus">Waiting</span>
    `;

    $('#uploadQueue').appendChild(item);

    const bar = item.querySelector('i');
    const status = item.querySelector('.qstatus');

    try {
      const out = await prepareImage(file);

      let path;

      if (replaceTargets.length) {
        path = replaceTargets[0].path;
      } else {
        const folder = $('#uploadFolder').value;

        let name =
          ($('#filenamePrefix').value.trim()
            ? $('#filenamePrefix').value.trim() + '-'
            : '') +
          out.name;

        path =
          (folder
            ? `assets/images/${folder}/`
            : 'assets/images/') +
          name;
      }

      status.textContent = 'Uploading…';
      bar.style.width = '40%';

      await api('/api/images/upload', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({
          path,
          content: out.dataUrl
        })
      });

      bar.style.width = '100%';
      status.textContent = 'Done';

      toast(
        replaceTargets.length
          ? 'Image replaced'
          : 'Image uploaded'
      );

      if (replaceTargets.length) break;

    } catch (e) {
      status.textContent = e.message;
      status.style.color = '#dc2626';
    }
  }

  await loadImages();
}

async function prepareImage(file) {
  if (file.type === 'image/svg+xml') {
    return {
      name: file.name,
      dataUrl: await readDataUrl(file)
    };
  }

  const bitmap = await createImageBitmap(file);

  const max = 2400;

  const scale = Math.min(
    1,
    max / Math.max(bitmap.width, bitmap.height)
  );

  const w = Math.max(
    1,
    Math.round(bitmap.width * scale)
  );

  const h = Math.max(
    1,
    Math.round(bitmap.height * scale)
  );

  const c = document.createElement('canvas');

  c.width = w;
  c.height = h;

  c.getContext('2d').drawImage(
    bitmap,
    0,
    0,
    w,
    h
  );

  const type =
    file.type === 'image/png'
      ? 'image/png'
      : 'image/webp';

  const blob = await new Promise(resolve =>
    c.toBlob(resolve, type, .88)
  );

  return {
    name:
      file.name.replace(/\.[^.]+$/, '') +
      (type === 'image/webp' ? '.webp' : '.png'),

    dataUrl:
      await readDataUrl(blob)
  };
}

function readDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();

    r.onload = () => res(r.result);
    r.onerror = rej;

    r.readAsDataURL(blob);
  });
}

function openModal() {
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
}

$('#modalClose').onclick = closeModal;

$('#modal').addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
});

async function boot() {
  try {
    const s = await api('/api/session');

    if (s.ok) {
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  $('#loginView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
}

function showApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  loadImages();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  $('#loginError').textContent = '';

  try {
    await api('/api/login', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        password: $('#password').value
      })
    });

    $('#password').value = '';
    showApp();

  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#logoutBtn').onclick = async () => {
  try {
    await api('/api/logout', {method:'POST'});
  } finally {
    showLogin();
  }
};

$('#refreshBtn').onclick = loadImages;

$('#uploadBtn').onclick = () =>
  document.querySelector('[data-view="upload"]').click();

document.querySelectorAll('.nav').forEach(b =>
  b.onclick = () => {
    document.querySelectorAll('.nav')
      .forEach(x => x.classList.remove('active'));

    b.classList.add('active');

    const v = b.dataset.view;

    $('#imagesView').classList.toggle(
      'hidden',
      v !== 'images'
    );

    $('#uploadView').classList.toggle(
      'hidden',
      v !== 'upload'
    );

    $('#pageTitle').textContent =
      v === 'images'
        ? 'Images'
        : 'Upload Image';

    if (v === 'upload') resetQueue();
  }
);

$('#search').oninput = render;
$('#folderFilter').onchange = render;

boot();
