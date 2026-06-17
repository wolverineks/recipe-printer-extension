export function normalizeUmbrelUrl(value) {
  let trimmed = (value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return { url: "", error: "" };

  trimmed = trimmed.replace(/\/api\/(ingest|ping)$/i, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  trimmed = trimmed.replace(/\/+$/, "");

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: "", error: "Invalid Umbrel URL format." };
  }

  if (!parsed.port) {
    return {
      url: "",
      error:
        "URL must include the Recipes app port (usually :4020). Example: http://192.168.1.50:4020",
    };
  }

  return { url: trimmed, error: "" };
}

export async function hasUmbrelPermission(umbrelUrl) {
  if (!umbrelUrl) return false;
  try {
    const origin = new URL(umbrelUrl).origin;
    return chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

export async function requestUmbrelPermission(umbrelUrl) {
  if (!umbrelUrl) return true;
  try {
    const origin = new URL(umbrelUrl).origin;
    const pattern = `${origin}/*`;
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    return chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

async function tryPing(umbrelUrl, umbrelToken, path) {
  const response = await fetch(`${umbrelUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${umbrelToken}` },
  });
  if (response.status === 401) {
    return { kind: "auth_error" };
  }
  if (response.ok) {
    return { kind: "ok" };
  }
  return { kind: "http_error", status: response.status, body: await response.text() };
}

async function tryIngestProbe(umbrelUrl, umbrelToken) {
  const response = await fetch(`${umbrelUrl}/api/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${umbrelToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (response.status === 401) {
    return { kind: "auth_error" };
  }
  if (response.status === 400) {
    return { kind: "ok" };
  }
  return { kind: "http_error", status: response.status, body: await response.text() };
}

export async function testUmbrelConnection(umbrelUrl, umbrelToken) {
  const normalized = normalizeUmbrelUrl(umbrelUrl);
  if (normalized.error) {
    return { ok: false, error: normalized.error };
  }
  if (!normalized.url || !umbrelToken?.trim()) {
    return { ok: false, error: "Enter both Umbrel URL and ingest token first." };
  }

  const url = normalized.url;
  const token = umbrelToken.trim();

  const permitted = await hasUmbrelPermission(url);
  if (!permitted) {
    return {
      ok: false,
      error:
        "Chrome has not been allowed to access your Umbrel URL. Click Save and approve the permission prompt.",
    };
  }

  try {
    for (const path of ["/api/ping", "/api/ingest"]) {
      const result = await tryPing(url, token, path);
      if (result.kind === "ok") {
        return { ok: true, url };
      }
      if (result.kind === "auth_error") {
        return { ok: false, error: "Invalid ingest token. Copy a fresh token from the Recipes app." };
      }
    }

    const ingestProbe = await tryIngestProbe(url, token);
    if (ingestProbe.kind === "ok") {
      return { ok: true, url };
    }
    if (ingestProbe.kind === "auth_error") {
      return { ok: false, error: "Invalid ingest token. Copy a fresh token from the Recipes app." };
    }

    const status = ingestProbe.status ?? 404;
    if (status === 404) {
      return {
        ok: false,
        error:
          `Got 404 at ${url}. Use the exact URL from the Recipes app including :4020, and update the app to v1.0.2.`,
      };
    }

    return {
      ok: false,
      error: `Umbrel responded with ${status}: ${(ingestProbe.body || "").slice(0, 120)}`,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.message ||
        "Could not reach Umbrel. Check the URL, port :4020, and that the Recipes app is running.",
    };
  }
}