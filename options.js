const form = document.getElementById("settings-form");
const apiKeyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const umbrelUrlInput = document.getElementById("umbrel-url");
const umbrelTokenInput = document.getElementById("umbrel-token");
const saveStatus = document.getElementById("save-status");
const umbrelStatus = document.getElementById("umbrel-status");
const testUmbrelBtn = document.getElementById("test-umbrel-btn");

function normalizeUmbrelUrl(value) {
  let trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  trimmed = trimmed.replace(/\/api\/ingest$/i, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed.replace(/\/+$/, "");
}

function umbrelOrigin(url) {
  return new URL(url).origin;
}

async function requestUmbrelPermission(url) {
  if (!url) return true;
  const pattern = `${umbrelOrigin(url)}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function hasUmbrelPermission(url) {
  if (!url) return false;
  try {
    return chrome.permissions.contains({ origins: [`${umbrelOrigin(url)}/*`] });
  } catch {
    return false;
  }
}

async function testUmbrelConnection(umbrelUrl, umbrelToken) {
  if (!umbrelUrl || !umbrelToken) {
    return { ok: false, error: "Enter both Umbrel URL and ingest token first." };
  }

  const permitted = await hasUmbrelPermission(umbrelUrl);
  if (!permitted) {
    return {
      ok: false,
      error: "Chrome has not been allowed to access your Umbrel URL. Click Save and approve the permission prompt.",
    };
  }

  try {
    const response = await fetch(`${umbrelUrl}/api/ping`, {
      method: "GET",
      headers: { Authorization: `Bearer ${umbrelToken}` },
    });
    if (response.status === 401) {
      return { ok: false, error: "Invalid ingest token. Copy a fresh token from the Recipes app." };
    }
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Umbrel responded with ${response.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Could not reach Umbrel. Check the URL and that the Recipes app is running.",
    };
  }
}

function setUmbrelStatus(message, type = "") {
  umbrelStatus.textContent = message;
  umbrelStatus.className = `umbrel-status${type ? ` ${type}` : ""}`;
}

async function refreshUmbrelStatus() {
  const umbrelUrl = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  if (!umbrelUrl && !umbrelToken) {
    setUmbrelStatus("Umbrel save is optional. Add URL + token to auto-save recipes.");
    return;
  }
  if (!umbrelUrl || !umbrelToken) {
    setUmbrelStatus("Add both Umbrel URL and ingest token, then click Save.", "error");
    return;
  }

  const permitted = await hasUmbrelPermission(umbrelUrl);
  if (!permitted) {
    setUmbrelStatus("Saved values detected, but Chrome network access is not granted yet. Click Save and allow access.", "error");
    return;
  }

  setUmbrelStatus("Configured. Click “Test Umbrel connection” to verify.", "ok");
}

async function loadSettings() {
  const { apiKey, model, umbrelUrl, umbrelToken } = await chrome.storage.local.get([
    "apiKey",
    "model",
    "umbrelUrl",
    "umbrelToken",
  ]);
  apiKeyInput.value = apiKey || "";
  modelSelect.value = model || "grok-4-1-fast";
  umbrelUrlInput.value = umbrelUrl || "";
  umbrelTokenInput.value = umbrelToken || "";
  await refreshUmbrelStatus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveStatus.textContent = "";
  saveStatus.className = "status";

  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const umbrelUrl = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  umbrelUrlInput.value = umbrelUrl;

  await chrome.storage.local.set({
    apiKey,
    model,
    umbrelUrl,
    umbrelToken,
  });

  let saveMessage = "Settings saved.";
  if (umbrelUrl) {
    const granted = await requestUmbrelPermission(umbrelUrl);
    if (!granted) {
      saveMessage = "Settings saved, but Chrome blocked Umbrel network access. Click Save again and choose Allow.";
      saveStatus.className = "status error";
    }
  }

  saveStatus.textContent = saveMessage;
  await refreshUmbrelStatus();
});

testUmbrelBtn.addEventListener("click", async () => {
  const umbrelUrl = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();
  umbrelUrlInput.value = umbrelUrl;

  await chrome.storage.local.set({ umbrelUrl, umbrelToken });

  if (umbrelUrl) {
    await requestUmbrelPermission(umbrelUrl);
  }

  setUmbrelStatus("Testing connection…");
  const result = await testUmbrelConnection(umbrelUrl, umbrelToken);
  if (result.ok) {
    setUmbrelStatus("Umbrel connection successful.", "ok");
  } else {
    setUmbrelStatus(result.error, "error");
  }
});

loadSettings();