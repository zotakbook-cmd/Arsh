/**
 * Arsh Technical Academy - GitHub Image CMS API
 * Cloudflare Worker + Workers Assets
 *
 * Required Worker secrets:
 *   GITHUB_TOKEN   = fine-grained GitHub token with Contents: Read/Write
 *   ADMIN_PASSWORD = CMS login password
 *   SESSION_SECRET = random long secret used to sign CMS sessions
 *
 * Optional vars:
 *   GITHUB_OWNER = zotakbook-cmd
 *   GITHUB_REPO  = Arsh
 *   GITHUB_BRANCH = main
 */

const CONFIG = {
  owner: 'zotakbook-cmd',
  repo: 'Arsh',
  branch: 'main',
  root: 'assets/images',
  maxUploadBytes: 8 * 1024 * 1024,
};

const IMAGE_EXTENSIONS = new Set([
  'jpg','jpeg','png','webp','gif','svg','avif','bmp','ico'
]);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function makeSession(env) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const payload = `arsh-cms:${exp}`;
  const sig = base64url(await hmac(env.SESSION_SECRET, payload));
  return `${exp}.${sig}`;
}

async function validSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)arsh_cms=([^;]+)/);
  if (!match) return false;

  const [expText, sig] = decodeURIComponent(match[1]).split('.');
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !sig) return false;

  const payload = `arsh-cms:${exp}`;
  const expected = await hmac(env.SESSION_SECRET, payload);
  let actual;
  try { actual = fromBase64url(sig); } catch { return false; }
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function cookieHeader(value, maxAge = 60 * 60 * 12) {
  return `arsh_cms=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookieHeader() {
  return 'arsh_cms=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict';
}

function safePath(path) {
  if (!path || typeof path !== 'string') return null;
  path = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.includes('..') || path.includes('//') || path.includes('\0')) return null;
  if (path !== CONFIG.root && !path.startsWith(CONFIG.root + '/')) return null;
  return path;
}

function extension(path) {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function isImage(path) {
  return IMAGE_EXTENSIONS.has(extension(path));
}

function githubHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Arsh-Image-CMS',
  };
}

function apiUrl(env, path = '') {
  return `https://api.github.com/repos/${env.GITHUB_OWNER || CONFIG.owner}/${env.GITHUB_REPO || CONFIG.repo}${path}`;
}

async function github(request, env, path, options = {}) {
  return fetch(apiUrl(env, path), {
    ...options,
    headers: { ...githubHeaders(env), ...(options.headers || {}) },
  });
}

async function requireAuth(request, env) {
  if (!env.GITHUB_TOKEN || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ ok: false, error: 'CMS secrets are not configured.' }, 500);
  }
  if (!(await validSession(request, env))) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }
  return null;
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: 'Invalid password.' }, 401);
  }
  const session = await makeSession(env);
  return json({ ok: true }, 200, { 'set-cookie': cookieHeader(session) });
}

async function handleList(request, env) {
  const branch = env.GITHUB_BRANCH || CONFIG.branch;
  const r = await github(request, env, `/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: data.message || 'GitHub tree request failed.' }, r.status);

  const files = (data.tree || [])
    .filter(x => x.type === 'blob' && x.path.startsWith(CONFIG.root + '/') && isImage(x.path))
    .map(x => ({
      path: x.path,
      name: x.path.split('/').pop(),
      folder: x.path.slice(CONFIG.root.length + 1).split('/').slice(0, -1).join('/'),
      sha: x.sha,
      size: x.size || 0,
      url: `https://raw.githubusercontent.com/${env.GITHUB_OWNER || CONFIG.owner}/${env.GITHUB_REPO || CONFIG.repo}/${encodeURIComponent(branch)}/${x.path.split('/').map(encodeURIComponent).join('/')}`,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return json({ ok: true, branch, root: CONFIG.root, files });
}

async function handleUpload(request, env) {
  const body = await request.json();
  const path = safePath(body.path);
  if (!path || !isImage(path)) return json({ ok: false, error: 'Invalid image path.' }, 400);
  if (!body.content || typeof body.content !== 'string') return json({ ok: false, error: 'Missing image content.' }, 400);

  const cleanBase64 = body.content.replace(/^data:[^;]+;base64,/, '');
  const estimatedBytes = Math.floor(cleanBase64.length * 0.75);
  if (estimatedBytes > CONFIG.maxUploadBytes) {
    return json({ ok: false, error: 'Image is larger than 8 MB.' }, 413);
  }

  const apiPath = `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const existing = await github(request, env, apiPath + `?ref=${encodeURIComponent(env.GITHUB_BRANCH || CONFIG.branch)}`);
  let sha;
  if (existing.ok) {
    const old = await existing.json();
    sha = old.sha;
  } else if (existing.status !== 404) {
    const err = await existing.json().catch(() => ({}));
    return json({ ok: false, error: err.message || 'Could not inspect existing file.' }, existing.status);
  }

  const action = sha ? 'Replace image' : 'Upload image';
  const r = await github(request, env, apiPath, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `${action}: ${path.split('/').pop()}`,
      content: cleanBase64,
      ...(sha ? { sha } : {}),
      branch: env.GITHUB_BRANCH || CONFIG.branch,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: data.message || 'GitHub upload failed.' }, r.status);
  return json({ ok: true, path, action, commit: data.commit?.sha || '' });
}

async function handleDelete(request, env) {
  const body = await request.json();
  const path = safePath(body.path);
  if (!path || !isImage(path)) return json({ ok: false, error: 'Invalid image path.' }, 400);

  const apiPath = `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const sha = body.sha || await getFileSha(request, env, path);
  if (!sha) return json({ ok: false, error: 'Image not found.' }, 404);

  const r = await github(request, env, apiPath, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `Delete image: ${path.split('/').pop()}`,
      sha,
      branch: env.GITHUB_BRANCH || CONFIG.branch,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: data.message || 'GitHub delete failed.' }, r.status);
  return json({ ok: true, path, commit: data.commit?.sha || '' });
}

async function handleRename(request, env) {
  const body = await request.json();
  const from = safePath(body.from);
  const to = safePath(body.to);
  if (!from || !to || !isImage(from) || !isImage(to)) return json({ ok: false, error: 'Invalid image path.' }, 400);
  if (from === to) return json({ ok: false, error: 'Source and destination are the same.' }, 400);

  const sha = body.sha || await getFileSha(request, env, from);
  if (!sha) return json({ ok: false, error: 'Source image not found.' }, 404);

  const branch = env.GITHUB_BRANCH || CONFIG.branch;
  const rawUrl = `https://raw.githubusercontent.com/${env.GITHUB_OWNER || CONFIG.owner}/${env.GITHUB_REPO || CONFIG.repo}/${encodeURIComponent(branch)}/${from.split('/').map(encodeURIComponent).join('/')}`;
  const raw = await fetch(rawUrl, { cf: { cacheTtl: 0 } });
  if (!raw.ok) return json({ ok: false, error: 'Could not read source image.' }, 502);
  const bytes = new Uint8Array(await raw.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  const content = btoa(binary);

  const create = await github(request, env, `/contents/${to.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `Rename image: ${from.split('/').pop()} -> ${to.split('/').pop()}`,
      content,
      branch,
    }),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok) return json({ ok: false, error: created.message || 'Could not create renamed image.' }, create.status);

  const remove = await github(request, env, `/contents/${from.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `Remove old image name: ${from.split('/').pop()}`,
      sha,
      branch: env.GITHUB_BRANCH || CONFIG.branch,
    }),
  });
  if (!remove.ok) {
    return json({ ok: false, error: 'New file created but old file could not be deleted.' }, 502);
  }
  return json({ ok: true, from, to });
}

async function getFileSha(request, env, path) {
  const r = await github(request, env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(env.GITHUB_BRANCH || CONFIG.branch)}`);
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return data.sha || null;
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'POST' && path === '/api/login') return handleLogin(request, env);
  if (request.method === 'POST' && path === '/api/logout') return json({ ok: true }, 200, { 'set-cookie': clearCookieHeader() });
  if (request.method === 'GET' && path === '/api/session') {
    return json({ ok: await validSession(request, env) });
  }

  const auth = await requireAuth(request, env);
  if (auth) return auth;

  if (request.method === 'GET' && path === '/api/images') return handleList(request, env);
  if (request.method === 'POST' && path === '/api/images/upload') return handleUpload(request, env);
  if (request.method === 'POST' && path === '/api/images/delete') return handleDelete(request, env);
  if (request.method === 'POST' && path === '/api/images/rename') return handleRename(request, env);

  return json({ ok: false, error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env);
      } catch (error) {
        return json({ ok: false, error: error?.message || 'Server error.' }, 500);
      }
    }

    // Keep the existing static website untouched.
    return env.ASSETS.fetch(request);
  },
};
