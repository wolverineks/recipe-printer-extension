import {
  hasUmbrelPermission,
  normalizeUmbrelUrl,
  requestUmbrelPermission,
  testUmbrelConnection,
} from "./umbrel-client.js";

const form = document.getElementById("settings-form");
const apiKeyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const umbrelUrlInput = document.getElementById("umbrel-url");
const umbrelTokenInput = document.getElementById("umbrel-token");
const saveStatus = document.getElementById("save-status");
const umbrelStatus = document.getElementById("umbrel-status");
const testUmbrelBtn = document.getElementById("test-umbrel-btn");

function setUmbrelStatus(message, type = "") {
  umbrelStatus.textContent = message;
  umbrelStatus.className = `umbrel-status${type ? ` ${type}` : ""}`;
}

async function refreshUmbrelStatus() {
  const normalized = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  if (normalized.error) {
    setUmbrelStatus(normalized.error, "error");
    return;
  }

  if (!normalized.url && !umbrelToken) {
    setUmbrelStatus("Umbrel save is optional. Add URL + token to auto-save recipes.");
    return;
  }
  if (!normalized.url || !umbrelToken) {
    setUmbrelStatus("Add both Umbrel URL (with :4020) and ingest token, then click Save.", "error");
    return;
  }

  const permitted = await hasUmbrelPermission(normalized.url);
  if (!permitted) {
    setUmbrelStatus(
      "Saved values detected, but Chrome network access is not granted yet. Click Save and allow access.",
      "error"
    );
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
  const normalized = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  if (normalized.error) {
    saveStatus.className = "status error";
    saveStatus.textContent = normalized.error;
    return;
  }

  const umbrelUrl = normalized.url;
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
      saveMessage =
        "Settings saved, but Chrome blocked Umbrel network access. Click Save again and choose Allow.";
      saveStatus.className = "status error";
    }
  }

  saveStatus.textContent = saveMessage;
  await refreshUmbrelStatus();
});

testUmbrelBtn.addEventListener("click", async () => {
  const normalized = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  if (normalized.error) {
    setUmbrelStatus(normalized.error, "error");
    return;
  }

  umbrelUrlInput.value = normalized.url;
  await chrome.storage.local.set({
    umbrelUrl: normalized.url,
    umbrelToken,
  });

  if (normalized.url) {
    await requestUmbrelPermission(normalized.url);
  }

  setUmbrelStatus("Testing connection…");
  const result = await testUmbrelConnection(normalized.url, umbrelToken);
  if (result.ok) {
    if (result.url && result.url !== normalized.url) {
      umbrelUrlInput.value = result.url;
      await chrome.storage.local.set({ umbrelUrl: result.url });
    }
    setUmbrelStatus("Umbrel connection successful.", "ok");
  } else {
    setUmbrelStatus(result.error, "error");
  }
});

loadSettings();