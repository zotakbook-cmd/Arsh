/**
 * =========================================================
 * ARSH TECHNICAL ACADEMY
 * GitHub Image CMS Worker
 * =========================================================
 *
 * Cloudflare Worker
 *
 * Required Secrets:
 *   ADMIN_PASSWORD
 *   SESSION_SECRET
 *   GITHUB_TOKEN
 *
 * GitHub settings come from:
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_BRANCH
 *
 * Managed folder:
 *   assets/images/
 * =========================================================
 */

const CONFIG = {
  IMAGE_ROOT: "assets/images",
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  SESSION_COOKIE: "arsh_cms",
  SESSION_HOURS: 12
};


function runtimeConfig(env) {
  return {
    owner: String(env.GITHUB_OWNER || "").trim(),
    repo: String(env.GITHUB_REPO || "").trim(),
    branch: String(env.GITHUB_BRANCH || "").trim()
  };
}


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function json(data, status = 200, extraHeaders = {}) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store, no-cache, must-revalidate",

        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",

        ...extraHeaders
      }
    }
  );

}


/* =========================================================
   BASE64URL
   ========================================================= */

function base64UrlEncode(bytes) {

  let binary = "";

  for (const byte of bytes) {

    binary += String.fromCharCode(byte);

  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

}


function base64UrlDecode(value) {

  const normalized =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const padding =
    normalized.length % 4;

  const padded =
    padding
      ? normalized + "=".repeat(4 - padding)
      : normalized;

  const binary =
    atob(padded);

  return Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

}


/* =========================================================
   HMAC
   ========================================================= */

async function createHmac(
  secret,
  value
) {

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value)
    );

  return new Uint8Array(signature);

}


/* =========================================================
   SESSION
   ========================================================= */

async function createSession(env) {

  const expires =
    Math.floor(Date.now() / 1000) +
    CONFIG.SESSION_HOURS * 60 * 60;

  const payload =
    `arsh-cms:${expires}`;

  const signature =
    await createHmac(
      env.SESSION_SECRET,
      payload
    );

  return (
    `${expires}.` +
    base64UrlEncode(signature)
  );

}


async function validateSession(
  request,
  env
) {

  const cookie =
    request.headers.get("Cookie") || "";

  const regex =
    new RegExp(
      `(?:^|;\\s*)${CONFIG.SESSION_COOKIE}=([^;]+)`
    );

  const match =
    cookie.match(regex);

  if (!match) {

    return false;

  }

  let token;

  try {

    token =
      decodeURIComponent(match[1]);

  } catch {

    return false;

  }

  const parts =
    token.split(".");

  if (parts.length !== 2) {

    return false;

  }

  const expires =
    Number(parts[0]);

  const signatureText =
    parts[1];

  if (
    !Number.isFinite(expires) ||
    expires <
      Math.floor(Date.now() / 1000)
  ) {

    return false;

  }

  let actual;

  try {

    actual =
      base64UrlDecode(
        signatureText
      );

  } catch {

    return false;

  }

  const payload =
    `arsh-cms:${expires}`;

  const expected =
    await createHmac(
      env.SESSION_SECRET,
      payload
    );

  if (
    actual.length !==
    expected.length
  ) {

    return false;

  }

  let difference = 0;

  for (
    let i = 0;
    i < expected.length;
    i++
  ) {

    difference |=
      actual[i] ^
      expected[i];

  }

  return difference === 0;

}


function sessionCookie(
  token
) {

  return [
    `${CONFIG.SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Max-Age=43200",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");

}


function deleteSessionCookie() {

  return [
    `${CONFIG.SESSION_COOKIE}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");

}


/* =========================================================
   PATH SECURITY
   ========================================================= */

function normalizeImagePath(input, fallbackName = "") {
  let raw = (typeof input === "string" && input.trim()) ? input : fallbackName;
  if (typeof raw !== "string") return null;

  let path = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!path) return null;

  if (path.includes("..") || path.includes("\0") || /[\r\n]/.test(path)) return null;

  if (!path.startsWith(CONFIG.IMAGE_ROOT + "/")) {
    if (path.includes("/")) return null;
    path = CONFIG.IMAGE_ROOT + "/" + path;
  }

  const parts = path.split("/");
  if (parts.length < 3) return null;
  if (parts[0] !== "assets" || parts[1] !== "images") return null;
  if (parts.some(part => !part || part === "." || part === "..")) return null;

  const filename = parts[parts.length - 1].trim();
  if (!filename || filename.length > 180) return null;
  if (/[\\\r\n\0]/.test(filename)) return null;

  if (!/\.(?:jpe?g|png|webp|gif|svg|avif|bmp|ico)$/i.test(filename)) return null;

  return path;
}

function safePath(path, fallbackName = "") {
  return normalizeImagePath(path, fallbackName);
}


/* =========================================================
   IMAGE TYPES
   ========================================================= */

const IMAGE_EXTENSIONS =
  new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "svg",
    "avif",
    "bmp",
    "ico"
  ]);


function getExtension(path) {

  const match =
    path
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);

  return match
    ? match[1]
    : "";

}


function isImage(path) {

  if (
    typeof path !== "string" ||
    path.length > 500
  ) {
    return false;
  }

  const name = path.split("/").pop() || "";

  if (
    !name ||
    name.length > 180 ||
    /[\\r\\n\\0]/.test(name)
  ) {
    return false;
  }

  return IMAGE_EXTENSIONS.has(
    getExtension(name)
  );

}


/* =========================================================
   GITHUB
   ========================================================= */

function githubHeaders(env) {

  return {

    "Authorization":
      `Bearer ${env.GITHUB_TOKEN}`,

    "Accept":
      "application/vnd.github+json",

    "X-GitHub-Api-Version":
      "2022-11-28",

    "User-Agent":
      "Arsh-Image-CMS"

  };

}


function githubUrl(
  env,
  path = ""
) {

  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();

  return (
    "https://api.github.com/repos/" +
    `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    path
  );

}


async function github(
  env,
  path,
  options = {}
) {

  return fetch(
    githubUrl(env, path),
    {
      ...options,

      headers: {
        ...githubHeaders(env),
        ...(options.headers || {})
      }
    }
  );

}


/* =========================================================
   CONFIG VALIDATION
   ========================================================= */

function secretStatus(env) {
  return {
    adminPassword:
      typeof env.ADMIN_PASSWORD === "string" &&
      env.ADMIN_PASSWORD.length > 0,

    githubToken:
      typeof env.GITHUB_TOKEN === "string" &&
      env.GITHUB_TOKEN.length > 0,

    sessionSecret:
      typeof env.SESSION_SECRET === "string" &&
      env.SESSION_SECRET.length > 0
  };
}

function loginSecretsConfigured(env) {
  const s = secretStatus(env);
  return s.adminPassword && s.sessionSecret;
}

function githubConfigured(env) {
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "").trim();

  return Boolean(
    secretStatus(env).githubToken &&
    owner &&
    repo &&
    branch
  );
}

function missingSecrets(env, includeGithub = true) {
  const s = secretStatus(env);
  const missing = [];

  if (!s.adminPassword) missing.push("ADMIN_PASSWORD");
  if (!s.sessionSecret) missing.push("SESSION_SECRET");
  if (includeGithub && !s.githubToken) {
    missing.push("GITHUB_TOKEN");
  }

  return missing;
}


function githubConfigStatus(env) {
  return {
    owner: Boolean(String(env.GITHUB_OWNER || "").trim()),
    repo: Boolean(String(env.GITHUB_REPO || "").trim()),
    branch: Boolean(String(env.GITHUB_BRANCH || "").trim()),
    token: secretStatus(env).githubToken
  };
}


function githubConfigurationError(env) {
  const cfg = githubConfigStatus(env);
  const missing = [];

  if (!cfg.owner) missing.push("GITHUB_OWNER");
  if (!cfg.repo) missing.push("GITHUB_REPO");
  if (!cfg.branch) missing.push("GITHUB_BRANCH");
  if (!cfg.token) missing.push("GITHUB_TOKEN");

  return missing;
}


/* =========================================================
   LOGIN
   ========================================================= */

async function login(
  request,
  env
) {

  if (!loginSecretsConfigured(env)) {
    return json(
      {
        ok: false,
        error:
          "Login configuration is incomplete.",
        missing:
          missingSecrets(env, false)
      },
      500
    );
  }

  const contentLength =
    Number(request.headers.get("content-length") || 0);

  if (
    Number.isFinite(contentLength) &&
    contentLength > 64 * 1024
  ) {
    return json(
      {
        ok: false,
        error: "Request is too large."
      },
      413
    );
  }

  const body =
    await request
      .json()
      .catch(() => ({}));

  const password =
    typeof body.password === "string"
      ? body.password
      : "";

  if (
    password.length === 0 ||
    password !== env.ADMIN_PASSWORD
  ) {

    return json(
      {
        ok: false,
        error:
          "Invalid password."
      },
      401
    );

  }

  const session =
    await createSession(env);

  return json(
    {
      ok: true
    },
    200,
    {
      "Set-Cookie":
        sessionCookie(session)
    }
  );

}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

  return json(
    {
      ok: true
    },
    200,
    {
      "Set-Cookie":
        deleteSessionCookie()
    }
  );

}


/* =========================================================
   SESSION CHECK
   ========================================================= */

async function sessionStatus(
  request,
  env
) {

  return json({
    ok:
      loginSecretsConfigured(env) &&
      await validateSession(
        request,
        env
      )
  });

}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

async function requireAuth(
  request,
  env
) {

  if (!loginSecretsConfigured(env)) {
    return json(
      {
        ok: false,
        error:
          "Login configuration is incomplete.",
        missing:
          missingSecrets(env, false)
      },
      500
    );
  }

  const authenticated =
    await validateSession(
      request,
      env
    );

  if (!authenticated) {

    return json(
      {
        ok: false,
        error:
          "Unauthorized."
      },
      401
    );

  }

  return null;

}


function githubErrorMessage(data, fallback) {
  if (data && typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }

  if (data && typeof data.error === "string" && data.error.trim()) {
    return data.error.trim();
  }

  return fallback;
}


/* =========================================================
   IMAGE FILE BUILDER
   ========================================================= */

function makeImageFile(env, branch, path, sha, size = 0) {

  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();

  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const rawUrl =
    `https://raw.githubusercontent.com/` +
    `${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/` +
    `${encodeURIComponent(branch)}/` +
    encodedPath;

  const parts = path.split("/");

  return {
    path,
    name: parts[parts.length - 1],
    folder: parts.slice(2, -1).join("/"),
    sha: sha || "",
    size: size || 0,
    url: rawUrl
  };

}


/* =========================================================
   LIST IMAGES
   ========================================================= */

async function listImages(env) {

  if (!githubConfigured(env)) {
    return json({
      ok: false,
      error: "GitHub integration is not configured.",
      missing: githubConfigurationError(env)
    }, 500);
  }

  const branch = String(env.GITHUB_BRANCH || "").trim();
  const files = [];
  const visitedDirs = new Set();

  /*
   * IMAGE LIST FIX
   *
   * GitHub's Contents API is used as the single source of truth.
   * The root assets/images directory is read directly first, exactly
   * like /api/github-images-debug. This guarantees that normal files
   * in the root are not lost. Subdirectories are then walked recursively.
   */

  async function readDirectory(path, page = 1) {

    const encodedPath = path
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const response = await github(
      env,
      `/contents/${encodedPath}?ref=${encodeURIComponent(branch)}&per_page=100&page=${page}`
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        githubErrorMessage(
          data,
          `Unable to read GitHub directory: ${path}`
        )
      );
    }

    if (!Array.isArray(data)) {
      throw new Error(
        `GitHub did not return a directory listing for ${path}.`
      );
    }

    for (const item of data) {

      if (!item || !item.path || !item.type) continue;

      if (item.type === "file") {

        /* Use the filename itself for extension detection. */
        if (isImage(item.name || item.path)) {
          files.push(
            makeImageFile(
              env,
              branch,
              item.path,
              item.sha,
              item.size || 0
            )
          );
        }

        continue;
      }

      if (item.type === "dir") {

        const dirKey = item.path;

        if (visitedDirs.has(dirKey)) continue;

        visitedDirs.add(dirKey);
        await readDirectory(item.path, 1);
      }
    }

    /* Handle GitHub Contents API pagination for directories >100 items. */
    if (data.length === 100) {
      await readDirectory(path, page + 1);
    }
  }

  try {
    /* This is intentionally the exact same root used by the diagnostic endpoint. */
    await readDirectory(CONFIG.IMAGE_ROOT, 1);
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "Unable to read GitHub images."
    }, 502);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return json({
    ok: true,
    root: CONFIG.IMAGE_ROOT,
    branch,
    source: "contents-direct-v2",
    truncated: false,
    count: files.length,
    files
  });
}

/* =========================================================
   GET FILE SHA
   ========================================================= */

async function getFileSha(
  env,
  path
) {

  const encodedPath =
    path
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");

  const response =
    await github(
      env,
      `/contents/${encodedPath}` +
      `?ref=${encodeURIComponent(
        (String(env.GITHUB_BRANCH || "").trim())
      )}`
    );

  if (!response.ok) {

    return null;

  }

  const data =
    await response
      .json()
      .catch(() => ({}));

  return data.sha || null;

}


/* =========================================================
   UPLOAD / REPLACE
   ========================================================= */

async function uploadImage(
  request,
  env
) {

  if (!githubConfigured(env)) {
    return json(
      {
        ok: false,
        error: "GitHub integration is not configured.",
        missing: githubConfigurationError(env)
      },
      500
    );
  }

  const body =
    await request
      .json()
      .catch(() => ({}));

  const receivedPath = typeof body.path === "string" ? body.path : "";
  const receivedFilename = typeof body.filename === "string" ? body.filename : "";
  const path = safePath(receivedPath, receivedFilename);

  if (!path) {
    return json(
      {
        ok: false,
        error: "Invalid image path.",
        receivedPath,
        receivedFilename,
        root: CONFIG.IMAGE_ROOT
      },
      400
    );
  }

  if (
    typeof body.content !==
    "string" ||
    !body.content
  ) {

    return json(
      {
        ok: false,
        error:
          "Image content is missing."
      },
      400
    );

  }

  const content =
    body.content
      .replace(
        /^data:[^;]+;base64,/i,
        ""
      )
      .replace(/\s/g, "");

  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(content) ||
    content.length % 4 !== 0
  ) {
    return json(
      {
        ok: false,
        error: "Invalid base64 image data."
      },
      400
    );
  }

  const estimatedBytes =
    Math.max(
      0,
      Math.floor(
        (content.length * 3) / 4
      ) -
      (content.endsWith("==") ? 2 :
       content.endsWith("=") ? 1 : 0)
    );

  if (
    estimatedBytes >
    CONFIG.MAX_UPLOAD_BYTES
  ) {

    return json(
      {
        ok: false,
        error:
          "Image size cannot exceed 8 MB."
      },
      413
    );

  }

  const encodedPath =
    path
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");

  const apiPath =
    `/contents/${encodedPath}`;

  const existing =
    await github(
      env,
      apiPath +
      `?ref=${encodeURIComponent(
        (String(env.GITHUB_BRANCH || "").trim())
      )}`
    );

  let sha = null;

  if (existing.ok) {

    const data =
      await existing.json();

    sha =
      data.sha || null;

  } else if (
    existing.status !== 404
  ) {

    const data =
      await existing
        .json()
        .catch(() => ({}));

    return json(
      {
        ok: false,
        error:
          githubErrorMessage(
            data,
            "Unable to check existing image."
          )
      },
      existing.status
    );

  }

  const action =
    sha
      ? "Replace image"
      : "Upload image";

  const response =
    await github(
      env,
      apiPath,
      {
        method: "PUT",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({

            message:
              `${action}: ` +
              path.split("/").pop(),

            content,

            branch:
              (String(env.GITHUB_BRANCH || "").trim()),

            ...(sha
              ? { sha }
              : {})

          })

      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {

    return json(
      {
        ok: false,
        error:
          githubErrorMessage(
            data,
            "GitHub upload failed."
          )
      },
      response.status
    );

  }

  return json({
    ok: true,
    action,
    path,
    commit:
      data.commit?.sha || ""
  });

}


/* =========================================================
   DELETE
   ========================================================= */

async function deleteImage(
  request,
  env
) {

  if (!githubConfigured(env)) {
    return json(
      {
        ok: false,
        error: "GitHub integration is not configured.",
        missing: githubConfigurationError(env)
      },
      500
    );
  }

  const body =
    await request
      .json()
      .catch(() => ({}));

  const path = normalizeImagePath(
    body.path,
    body.filename || body.name || ""
  );

  if (!path) {
    return json({
      ok: false,
      error: "Invalid image path.",
      receivedPath: typeof body.path === "string" ? body.path : null,
      receivedFilename: typeof body.filename === "string" ? body.filename : null,
      imageRoot: CONFIG.IMAGE_ROOT,
      hint: "Send filename.webp or assets/images/filename.webp"
    }, 400);
  }

  const sha =
    body.sha ||
    await getFileSha(
      env,
      path
    );

  if (!sha) {

    return json(
      {
        ok: false,
        error:
          "Image not found."
      },
      404
    );

  }

  const encodedPath =
    path
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");

  const response =
    await github(
      env,
      `/contents/${encodedPath}`,
      {
        method: "DELETE",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({

            message:
              `Delete image: ` +
              path.split("/").pop(),

            sha,

            branch:
              (String(env.GITHUB_BRANCH || "").trim())

          })

      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {

    return json(
      {
        ok: false,
        error:
          githubErrorMessage(
            data,
            "GitHub delete failed."
          )
      },
      response.status
    );

  }

  return json({
    ok: true,
    path,
    commit:
      data.commit?.sha || ""
  });

}


/* =========================================================
   RENAME
   ========================================================= */

async function renameImage(
  request,
  env
) {

  if (!githubConfigured(env)) {
    return json(
      {
        ok: false,
        error: "GitHub integration is not configured.",
        missing: githubConfigurationError(env)
      },
      500
    );
  }

  const body =
    await request
      .json()
      .catch(() => ({}));

  const from =
    safePath(body.from);

  const to =
    safePath(body.to);

  if (
    !from ||
    !to ||
    !isImage(from) ||
    !isImage(to)
  ) {

    return json(
      {
        ok: false,
        error:
          "Invalid image path."
      },
      400
    );

  }

  if (from === to) {

    return json(
      {
        ok: false,
        error:
          "Source and destination are identical."
      },
      400
    );

  }

  const sha =
    body.sha ||
    await getFileSha(
      env,
      from
    );

  if (!sha) {

    return json(
      {
        ok: false,
        error:
          "Source image not found."
      },
      404
    );

  }

  const encodedFrom =
    from
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");

  const encodedTo =
    to
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");

  const sourceResponse =
    await github(
      env,
      `/contents/${encodedFrom}` +
      `?ref=${encodeURIComponent(
        (String(env.GITHUB_BRANCH || "").trim())
      )}`
    );

  const sourceData =
    await sourceResponse
      .json()
      .catch(() => ({}));

  if (
    !sourceResponse.ok ||
    !sourceData.content
  ) {

    return json(
      {
        ok: false,
        error:
          "Unable to read source image."
      },
      502
    );

  }

  const createResponse =
    await github(
      env,
      `/contents/${encodedTo}`,
      {
        method: "PUT",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({

            message:
              `Rename image: ` +
              `${from.split("/").pop()} → ` +
              `${to.split("/").pop()}`,

            content:
              sourceData.content
                .replace(/\s/g, ""),

            branch:
              (String(env.GITHUB_BRANCH || "").trim())

          })

      }
    );

  const created =
    await createResponse
      .json()
      .catch(() => ({}));

  if (!createResponse.ok) {

    return json(
      {
        ok: false,
        error:
          githubErrorMessage(
            created,
            "Unable to create renamed image."
          )
      },
      createResponse.status
    );

  }

  const deleteResponse =
    await github(
      env,
      `/contents/${encodedFrom}`,
      {
        method: "DELETE",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({

            message:
              `Delete old image name: ` +
              from.split("/").pop(),

            sha,

            branch:
              (String(env.GITHUB_BRANCH || "").trim())

          })

      }
    );

  if (!deleteResponse.ok) {

    return json(
      {
        ok: false,
        error:
          "New image created, but old image could not be deleted."
      },
      502
    );

  }

  return json({
    ok: true,
    from,
    to
  });

}


/* =========================================================
   API ROUTER
   ========================================================= */

async function api(
  request,
  env
) {

  const url =
    new URL(request.url);

  const path =
    url.pathname;


  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store"
      }
    });
  }


  /* CONFIG STATUS — safe diagnostic; never exposes secret values */

  if (
    request.method === "GET" &&
    path === "/api/config-status"
  ) {
    const s = secretStatus(env);
    const g = githubConfigStatus(env);

    return json({
      ok:
        s.adminPassword &&
        s.sessionSecret &&
        g.token &&
        g.owner &&
        g.repo &&
        g.branch,

      secrets: s,

      github: {
        configured: g.owner && g.repo && g.branch && g.token,
        owner: g.owner,
        repo: g.repo,
        branch: g.branch,
        token: g.token
      },

      missingForLogin:
        missingSecrets(env, false),

      missingForGithub:
        githubConfigurationError(env),
      imageRoot: CONFIG.IMAGE_ROOT,
      workerVersion: "2026-09-30-upload-v7"
    });
  }


  /* HEALTH */

  if (
    request.method === "GET" &&
    path === "/api/health"
  ) {
    return json({
      ok: true,
      service: "arsh-image-cms",
      version: "2026-09-30-upload-v7",
      authenticated:
        await validateSession(request, env)
    });
  }


  /* LOGIN */

  if (
    request.method === "POST" &&
    path === "/api/login"
  ) {

    return login(
      request,
      env
    );

  }


  /* LOGOUT */

  if (
    request.method === "POST" &&
    path === "/api/logout"
  ) {

    return logout();

  }


  /* SESSION */

  if (
    request.method === "GET" &&
    path === "/api/session"
  ) {

    return sessionStatus(
      request,
      env
    );

  }


  /* AUTHENTICATION */

  const auth =
    await requireAuth(
      request,
      env
    );

  if (auth) {

    return auth;

  }


  /* GITHUB IMAGES DEBUG — safe metadata only */

  if (
    request.method === "GET" &&
    path === "/api/github-images-debug"
  ) {

    if (!githubConfigured(env)) {
      return json(
        {
          ok: false,
          error: "GitHub configuration is incomplete.",
          missing: githubConfigurationError(env)
        },
        500
      );
    }

    const branch = String(env.GITHUB_BRANCH || "").trim();
    const imageRoot = CONFIG.IMAGE_ROOT;
    const encodedPath = imageRoot
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const response = await github(
      env,
      `/contents/${encodedPath}?ref=${encodeURIComponent(branch)}&per_page=100&page=1`
    );

    const data = await response.json().catch(() => null);

    const safeItems = Array.isArray(data)
      ? data.map(item => ({
          name: item?.name || "",
          type: item?.type || "",
          path: item?.path || "",
          sha: item?.sha || "",
          size: Number(item?.size || 0)
        }))
      : [];

    return json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      endpoint: `/contents/${imageRoot}?ref=${branch}`,
      isArray: Array.isArray(data),
      itemCount: safeItems.length,
      items: safeItems,
      responseKeys:
        data && typeof data === "object" && !Array.isArray(data)
          ? Object.keys(data)
          : []
    }, response.ok ? 200 : 502);
  }


  /* IMAGE LIST */

  if (
    request.method === "GET" &&
    path === "/api/images"
  ) {

    return listImages(env);

  }


  /* UPLOAD / REPLACE */

  if (
    request.method === "POST" &&
    path === "/api/images/upload"
  ) {

    return uploadImage(
      request,
      env
    );

  }


  /* DELETE */

  if (
    request.method === "POST" &&
    path === "/api/images/delete"
  ) {

    return deleteImage(
      request,
      env
    );

  }


  /* RENAME */

  if (
    request.method === "POST" &&
    path === "/api/images/rename"
  ) {

    return renameImage(
      request,
      env
    );

  }


  return json(
    {
      ok: false,
      error: "Not found."
    },
    404
  );

}


/* =========================================================
   CLOUDFLARE WORKER
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(request.url);


    /* API */

    if (
      url.pathname.startsWith(
        "/api/"
      )
    ) {

      try {

        return await api(
          request,
          env
        );

      } catch (error) {

        console.error(
          "CMS ERROR:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Internal server error."
          },
          500
        );

      }

    }


    /*
     * Existing website remains untouched.
     *
     * Cloudflare Assets serves:
     * index.html
     * about.html
     * courses.html
     * cms/index.html
     * assets/images/*
     */

    return env.ASSETS.fetch(
      request
    );

  }

};
