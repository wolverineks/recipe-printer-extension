import {
  fetchExtensionConfig,
  hasUmbrelPermission,
  normalizeUmbrelUrl,
  requestUmbrelPermission,
  testUmbrelConnection,
} from "./umbrel-client.js";

const form = document.getElementById("settings-form");
const umbrelUrlInput = document.getElementById("umbrel-url");
const umbrelTokenInput = document.getElementById("umbrel-token");
const saveStatus = document.getElementById("save-status");
const umbrelStatus = document.getElementById("umbrel-status");
const testUmbrelBtn = document.getElementById("test-umbrel-btn");

function setUmbrelStatus(message, type = "") {
  umbrelStatus.textContent = message;
  umbrelStatus.className = `umbrel-status${type ? ` ${type}` : ""}`;
}

async function refreshExtensionConfigStatus(url, token) {
  if (!url || !token) {
    return;
  }
  const permitted = await hasUmbrelPermission(url);
  if (!permitted) {
    return;
  }
  const config = await fetchExtensionConfig(url, token);
  if (config.ok) {
    setUmbrelStatus(
      `Connected. Using ${config.model || "grok-4-1-fast"} from the Recipes app.`,
      "ok",
    );
    return;
  }
  if (config.not_configured) {
    setUmbrelStatus(
      "Connected, but no xAI API key is saved in Recipes yet. Add one under Add new device.",
      "error",
    );
    return;
  }
  if (config.error) {
    setUmbrelStatus(config.error, "error");
  }
}

async function refreshUmbrelStatus() {
  const normalized = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  if (normalized.error) {
    setUmbrelStatus(normalized.error, "error");
    return;
  }

  if (!normalized.url && !umbrelToken) {
    setUmbrelStatus("Add your Umbrel URL (with :4020) and ingest token, then click Save.");
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
      "error",
    );
    return;
  }

  setUmbrelStatus("Configured. Click “Test Umbrel connection” to verify.", "ok");
  await refreshExtensionConfigStatus(normalized.url, umbrelToken);
}

async function loadSettings() {
  await chrome.storage.local.remove(["apiKey", "model"]);
  const { umbrelUrl, umbrelToken } = await chrome.storage.local.get(["umbrelUrl", "umbrelToken"]);
  umbrelUrlInput.value = umbrelUrl || "";
  umbrelTokenInput.value = umbrelToken || "";
  await refreshUmbrelStatus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveStatus.textContent = "";
  saveStatus.className = "status";

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
    umbrelUrl,
    umbrelToken,
  });
  await chrome.storage.local.remove(["apiKey", "model"]);

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
    await refreshExtensionConfigStatus(result.url || normalized.url, umbrelToken);
    if (umbrelStatus.textContent === "Testing connection…") {
      setUmbrelStatus("Umbrel connection successful.", "ok");
    }
  } else {
    setUmbrelStatus(result.error, "error");
  }
});

loadSettings();