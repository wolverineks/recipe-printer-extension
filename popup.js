import { normalizeUmbrelUrl } from "./umbrel-client.js";

const saveLaterBtn = document.getElementById("save-later-btn");
const savePrintBtn = document.getElementById("save-print-btn");
const statusEl = document.getElementById("status");
const umbrelHint = document.getElementById("umbrel-hint");
const setupWarning = document.getElementById("setup-warning");
const openOptionsBtn = document.getElementById("open-options");
const openRecipesBtn = document.getElementById("open-recipes");
const settingsLink = document.getElementById("settings-link");

const actionButtons = [saveLaterBtn, savePrintBtn];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setButtonsDisabled(disabled) {
  for (const button of actionButtons) {
    button.disabled = disabled;
  }
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

async function openRecipesApp() {
  const { umbrelUrl } = await chrome.storage.local.get("umbrelUrl");
  const normalized = normalizeUmbrelUrl(umbrelUrl);
  if (normalized.error) {
    setStatus(normalized.error, true);
    return;
  }
  if (!normalized.url) {
    setStatus("Add your Umbrel Recipes URL in Settings first.", true);
    openOptions();
    return;
  }
  await chrome.tabs.create({ url: normalized.url });
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

async function checkBlocked(sourceUrl) {
  return chrome.runtime.sendMessage({
    type: "CHECK_RECIPE_BLOCKED",
    sourceUrl,
  });
}

async function saveToUmbrel(recipe) {
  return chrome.runtime.sendMessage({
    type: "SAVE_TO_UMBREL",
    recipe,
  });
}

function blockedStatusMessage(result) {
  return (
    result?.error ||
    (result?.title
      ? `“${result.title}” is on your blocklist. Unblock it in the Recipes app to save or print it again.`
      : "This recipe is on your blocklist. Unblock it in the Recipes app to save or print it again.")
  );
}

async function openPrintPage(recipe) {
  await chrome.storage.session.set({ printRecipe: recipe });
  const url = chrome.runtime.getURL("print.html?auto=1");
  await chrome.tabs.create({ url });
}

async function processRecipe({ shouldPrint }) {
  setButtonsDisabled(true);
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

    setStatus("Checking blocklist…");
    const blockCheck = await checkBlocked(extracted.data.url);
    if (blockCheck?.blocked) {
      setStatus(blockedStatusMessage(blockCheck), true);
      setButtonsDisabled(false);
      return;
    }
    if (blockCheck?.error) {
      throw new Error(blockCheck.error);
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

    if (saved?.blocked) {
      setStatus(blockedStatusMessage(saved), true);
      setButtonsDisabled(false);
      return;
    }

    if (!shouldPrint) {
      if (saved?.skipped) {
        throw new Error("Connect Umbrel in extension Settings to save recipes for later.");
      }
      if (!saved?.ok) {
        throw new Error(saved?.error || "Umbrel save failed.");
      }
      setStatus("Saved to Umbrel for later.");
      window.close();
      return;
    }

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
      setButtonsDisabled(false);
      return;
    }

    window.close();
  } catch (err) {
    setStatus(err.message || "Something went wrong.", true);
    setButtonsDisabled(false);
  }
}

async function loadUmbrelHint() {
  const status = await chrome.runtime.sendMessage({ type: "GET_UMBREL_STATUS" });
  if (!status?.configured) {
    umbrelHint.textContent =
      "Tip: connect Umbrel in Settings to use Save for later. Save & print works without saving.";
    umbrelHint.classList.remove("hidden");
    return;
  }
  if (!status.permitted) {
    umbrelHint.textContent =
      "Umbrel is configured but Chrome network access is not allowed yet. Open Settings, click Save, and choose Allow.";
    umbrelHint.classList.remove("hidden");
    return;
  }
  umbrelHint.classList.add("hidden");
}

async function init() {
  const [extensionStatus, umbrelStatus] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATUS" }),
    chrome.runtime.sendMessage({ type: "GET_UMBREL_STATUS" }),
  ]);

  const hasKey = Boolean(extensionStatus?.hasApiKey);
  const umbrelReady = Boolean(
    umbrelStatus?.configured && umbrelStatus?.permitted && extensionStatus?.umbrelConfigured,
  );

  setupWarning.classList.toggle("hidden", hasKey);
  if (!hasKey) {
    const warningText = setupWarning.querySelector("p");
    if (warningText) {
      warningText.textContent = extensionStatus?.umbrelConfigured
        ? extensionStatus?.configError ||
          "No xAI API key saved in the Recipes app. Add one under Setup."
        : "Connect Umbrel in extension Settings, then save the xAI API key in Recipes → Setup.";
    }
  }

  savePrintBtn.disabled = !hasKey;
  saveLaterBtn.disabled = !hasKey || !umbrelReady;

  await loadUmbrelHint();

  openOptionsBtn.addEventListener("click", openOptions);
  openRecipesBtn.addEventListener("click", openRecipesApp);
  settingsLink.addEventListener("click", openOptions);
  saveLaterBtn.addEventListener("click", () => processRecipe({ shouldPrint: false }));
  savePrintBtn.addEventListener("click", () => processRecipe({ shouldPrint: true }));
}

init();