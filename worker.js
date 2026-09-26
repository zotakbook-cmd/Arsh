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

function safePath(path) {

  if (
    !path ||
    typeof path !== "string"
  ) {

    return null;

  }

  path =
    path
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");

  if (
    path.includes("..") ||
    path.includes("//") ||
    path.includes("\0")
  ) {

    return null;

  }

  if (
    path !== CONFIG.IMAGE_ROOT &&
    !path.startsWith(
      CONFIG.IMAGE_ROOT + "/"
    )
  ) {

    return null;

  }

  return path;

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

  return IMAGE_EXTENSIONS.has(
    getExtension(path)
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

  const owner = env.GITHUB_OWNER || "zotakbook-cmd";
  const repo = env.GITHUB_REPO || "Arsh";

  return (
    "https://api.github.com/repos/" +
    `${owner}/${repo}` +
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
  return secretStatus(env).githubToken;
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


/* =========================================================
   LIST IMAGES
   ========================================================= */

async function listImages(
  env
) {

  if (!githubConfigured(env)) {
    return json(
      {
        ok: false,
        error: "GitHub integration is not configured.",
        missing: ["GITHUB_TOKEN"]
      },
      500
    );
  }

  const branch =
    env.GITHUB_BRANCH || "main";

  const response =
    await github(
      env,
      `/git/trees/${encodeURIComponent(
        branch
      )}?recursive=1`
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
          data.message ||
          "Unable to read GitHub repository."
      },
      response.status
    );

  }

  const files =
    (data.tree || [])

      .filter(
        item =>
          item.type === "blob" &&
          item.path.startsWith(
            CONFIG.IMAGE_ROOT + "/"
          ) &&
          isImage(item.path)
      )

      .map(item => {

        const encodedPath =
          item.path
            .split("/")
            .map(
              encodeURIComponent
            )
            .join("/");

        const rawUrl =
          `https://raw.githubusercontent.com/` +
          `${env.GITHUB_OWNER || "zotakbook-cmd"}/` +
          `${env.GITHUB_REPO || "Arsh"}/` +
          `${encodeURIComponent(branch)}/` +
          encodedPath;

        const parts =
          item.path.split("/");

        return {

          path:
            item.path,

          name:
            parts[parts.length - 1],

          folder:
            parts
              .slice(
                2,
                -1
              )
              .join("/"),

          sha:
            item.sha,

          size:
            item.size || 0,

          url:
            rawUrl

        };

      })

      .sort(
        (a, b) =>
          a.path.localeCompare(
            b.path
          )
      );

  return json({
    ok: true,
    root:
      CONFIG.IMAGE_ROOT,
    branch,
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
        (env.GITHUB_BRANCH || "main")
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
        missing: ["GITHUB_TOKEN"]
      },
      500
    );
  }

  const body =
    await request
      .json()
      .catch(() => ({}));

  const path =
    safePath(body.path);

  if (
    !path ||
    !isImage(path)
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
        /^data:[^;]+;base64,/,
        ""
      );

  const estimatedBytes =
    Math.floor(
      content.length * 0.75
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
        (env.GITHUB_BRANCH || "main")
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
          data.message ||
          "Unable to check existing image."
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
              (env.GITHUB_BRANCH || "main"),

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
          data.message ||
          "GitHub upload failed."
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
        missing: ["GITHUB_TOKEN"]
      },
      500
    );
  }

  const body =
    await request
      .json()
      .catch(() => ({}));

  const path =
    safePath(body.path);

  if (
    !path ||
    !isImage(path)
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
              (env.GITHUB_BRANCH || "main")

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
          data.message ||
          "GitHub delete failed."
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
        missing: ["GITHUB_TOKEN"]
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
        (env.GITHUB_BRANCH || "main")
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
              (env.GITHUB_BRANCH || "main")

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
          created.message ||
          "Unable to create renamed image."
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
              (env.GITHUB_BRANCH || "main")

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


  /* CONFIG STATUS — safe diagnostic; never exposes secret values */

  if (
    request.method === "GET" &&
    path === "/api/config-status"
  ) {
    const s = secretStatus(env);

    return json({
      ok:
        s.adminPassword &&
        s.sessionSecret &&
        s.githubToken,

      secrets: s,

      github:
        Boolean(
          env.GITHUB_OWNER &&
          env.GITHUB_REPO &&
          env.GITHUB_BRANCH
        )
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