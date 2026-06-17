const printBtn = document.getElementById("print-btn");
const statusEl = document.getElementById("status");
const umbrelHint = document.getElementById("umbrel-hint");
const setupWarning = document.getElementById("setup-warning");
const openOptionsBtn = document.getElementById("open-options");
const settingsLink = document.getElementById("settings-link");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function extractFromTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "EXTRACT_RECIPE" });
}

async function formatWithGrok(rawData) {
  return chrome.runtime.sendMessage({
    type: "FORMAT_RECIPE",
    rawData,
  });
}

async function saveToUmbrel(recipe) {
  return chrome.runtime.sendMessage({
    type: "SAVE_TO_UMBREL",
    recipe,
  });
}

async function openPrintPage(recipe) {
  await chrome.storage.session.set({ printRecipe: recipe });
  const url = chrome.runtime.getURL("print.html?auto=1");
  await chrome.tabs.create({ url });
}

async function handlePrint() {
  printBtn.disabled = true;
  setStatus("Extracting recipe from page…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }
    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      throw new Error("Open a recipe webpage first.");
    }

    await ensureContentScript(tab.id);
    const extracted = await extractFromTab(tab.id);

    if (!extracted?.ok) {
      throw new Error(extracted?.error || "Could not extract recipe content.");
    }

    setStatus("Formatting with Grok…");
    const formatted = await formatWithGrok(extracted.data);

    if (!formatted?.ok) {
      throw new Error(formatted?.error || "Grok formatting failed.");
    }

    setStatus("Saving to Umbrel…");
    const recipeForUmbrel = {
      ...formatted.data,
      ...(extracted.data.image_url ? { image_url: extracted.data.image_url } : {}),
    };
    const saved = await saveToUmbrel(recipeForUmbrel);
    let keepOpen = false;

    if (saved?.ok) {
      setStatus("Saved to Umbrel. Opening print preview…");
    } else if (saved?.skipped) {
      setStatus("Umbrel not configured. Printing without saving…");
      keepOpen = true;
    } else {
      setStatus(`${saved?.error || "Umbrel save failed."} Printing anyway…`, true);
      keepOpen = true;
    }

    await openPrintPage(formatted.data);

    if (keepOpen) {
      printBtn.disabled = false;
      return;
    }

    window.close();
  } catch (err) {
    setStatus(err.message || "Something went wrong.", true);
    printBtn.disabled = false;
  }
}

async function loadUmbrelHint() {
  const status = await chrome.runtime.sendMessage({ type: "GET_UMBREL_STATUS" });
  if (!status?.configured) {
    umbrelHint.textContent = "Tip: in the Recipes app click Add new device, then paste URL + token into extension Settings.";
    umbrelHint.classList.remove("hidden");
    return;
  }
  if (!status.permitted) {
    umbrelHint.textContent = "Umbrel is configured but Chrome network access is not allowed yet. Open Settings, click Save, and choose Allow.";
    umbrelHint.classList.remove("hidden");
    return;
  }
  umbrelHint.classList.add("hidden");
}

async function init() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const hasKey = Boolean(apiKey?.trim());
  setupWarning.classList.toggle("hidden", hasKey);
  printBtn.disabled = !hasKey;

  await loadUmbrelHint();

  openOptionsBtn.addEventListener("click", openOptions);
  settingsLink.addEventListener("click", openOptions);
  printBtn.addEventListener("click", handlePrint);
}

init();