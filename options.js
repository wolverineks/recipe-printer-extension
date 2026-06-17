const form = document.getElementById("settings-form");
const apiKeyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const umbrelUrlInput = document.getElementById("umbrel-url");
const umbrelTokenInput = document.getElementById("umbrel-token");
const saveStatus = document.getElementById("save-status");

function normalizeUmbrelUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed;
}

async function requestUmbrelPermission(url) {
  if (!url) return true;
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }

  const pattern = `${origin}/*`;
  const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
  if (hasPermission) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function loadSettings() {
  const { apiKey, model, umbrelUrl, umbrelToken } = await chrome.storage.local.get([
    "apiKey",
    "model",
    "umbrelUrl",
    "umbrelToken",
  ]);
  if (apiKey) apiKeyInput.value = apiKey;
  if (model) modelSelect.value = model;
  if (umbrelUrl) umbrelUrlInput.value = umbrelUrl;
  if (umbrelToken) umbrelTokenInput.value = umbrelToken;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveStatus.textContent = "";

  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const umbrelUrl = normalizeUmbrelUrl(umbrelUrlInput.value);
  const umbrelToken = umbrelTokenInput.value.trim();

  if (umbrelUrl) {
    const granted = await requestUmbrelPermission(umbrelUrl);
    if (!granted) {
      saveStatus.textContent = "Chrome blocked access to your Umbrel URL. Allow the permission and save again.";
      saveStatus.style.color = "#b91c1c";
      return;
    }
  }

  await chrome.storage.local.set({
    apiKey,
    model,
    umbrelUrl,
    umbrelToken,
  });

  saveStatus.style.color = "#047857";
  saveStatus.textContent = "Settings saved.";
});

loadSettings();