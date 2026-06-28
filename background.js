import { RECIPE_JSON_SCHEMA, SYSTEM_PROMPT } from "./recipe-schema.js";
import {
  checkRecipeBlocked,
  fetchExtensionConfig,
  hasUmbrelPermission,
  normalizeUmbrelUrl,
} from "./umbrel-client.js";

const DEFAULT_MODEL = "grok-4-1-fast";

async function resolveApiCredentials(umbrelUrl, umbrelToken) {
  let apiKey = "";
  let model = DEFAULT_MODEL;
  let umbrelHasApiKey = false;
  let configError = null;

  if (umbrelUrl && umbrelToken) {
    const remote = await fetchExtensionConfig(umbrelUrl, umbrelToken);
    if (remote.ok && remote.api_key) {
      apiKey = remote.api_key;
      model = remote.model || model;
      umbrelHasApiKey = true;
    } else if (remote.not_configured) {
      configError =
        "No xAI API key saved in the Recipes app. Add one under Setup.";
    } else if (remote.error) {
      configError = remote.error;
    }
  }

  return { apiKey, model, umbrelHasApiKey, configError };
}

async function getSettings() {
  const local = await chrome.storage.local.get(["umbrelUrl", "umbrelToken"]);
  const normalized = normalizeUmbrelUrl(local.umbrelUrl || "");
  const umbrelToken = (local.umbrelToken || "").trim();
  const credentials = await resolveApiCredentials(normalized.url, umbrelToken);
  return {
    apiKey: credentials.apiKey,
    model: credentials.model,
    umbrelHasApiKey: credentials.umbrelHasApiKey,
    configError: credentials.configError,
    umbrelUrl: normalized.url,
    umbrelUrlError: normalized.error,
    umbrelToken,
  };
}

function buildUserPrompt(raw) {
  return `Source URL: ${raw.url}
Page title: ${raw.title}
Extraction method: ${raw.extractionMethod}

Recipe content:
${raw.text}`;
}

async function formatRecipe(rawData) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) {
    const { umbrelUrl, umbrelToken, umbrelUrlError, configError } = await getSettings();
    if (umbrelUrlError) {
      return { ok: false, error: umbrelUrlError };
    }
    if (!umbrelUrl || !umbrelToken) {
      return {
        ok: false,
        error:
          "Extension is not connected to Umbrel. Add your Recipes URL and ingest token in extension Settings.",
      };
    }
    return {
      ok: false,
      error:
        configError ||
        "No xAI API key saved in the Recipes app. Add one under Setup.",
    };
  }

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(rawData) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "recipe",
          schema: RECIPE_JSON_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      return {
        ok: false,
        error: "Invalid xAI API key saved in the Recipes app. Update it under Setup.",
      };
    }
    if (response.status === 429) {
      return { ok: false, error: "Rate limited by xAI. Wait a moment and try again." };
    }
    return {
      ok: false,
      error: `Grok API error (${response.status}): ${body.slice(0, 200)}`,
    };
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: false, error: "Grok returned an empty response." };
  }

  try {
    const recipe = JSON.parse(content);
    if (!recipe.source_url) recipe.source_url = rawData.url;
    return { ok: true, data: recipe };
  } catch {
    return { ok: false, error: "Failed to parse Grok response as JSON." };
  }
}

async function saveToUmbrel(recipe) {
  const { umbrelUrl, umbrelUrlError, umbrelToken } = await getSettings();

  if (!umbrelUrl && !umbrelToken) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }
  if (umbrelUrlError) {
    return { ok: false, error: umbrelUrlError };
  }
  if (!umbrelUrl || !umbrelToken) {
    return {
      ok: false,
      error: "Umbrel is partially configured. Add both URL (with :4020) and ingest token in extension Settings.",
    };
  }

  const permitted = await hasUmbrelPermission(umbrelUrl);
  if (!permitted) {
    return {
      ok: false,
      error: "Chrome blocked Umbrel access. Open extension Settings, click Save, and allow the network permission.",
    };
  }

  try {
    const response = await fetch(`${umbrelUrl}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${umbrelToken}`,
      },
      body: JSON.stringify(recipe),
    });

    if (response.status === 401) {
      return { ok: false, error: "Invalid Umbrel ingest token. Copy a fresh token from the Recipes app." };
    }
    if (!response.ok) {
      const raw = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (payload?.blocked) {
        return {
          ok: false,
          blocked: true,
          title: payload.title || null,
          error:
            payload.error ||
            (payload.title
              ? `“${payload.title}” is on your blocklist. Unblock it in the Recipes app to save or print it again.`
              : "This recipe is on your blocklist. Unblock it in the Recipes app to save or print it again."),
        };
      }
      const body = payload ? JSON.stringify(payload) : raw;
      return {
        ok: false,
        error: `Umbrel save failed (${response.status}): ${String(body).slice(0, 160)}`,
      };
    }

    const payload = await response.json();
    return { ok: true, id: payload.id };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Could not reach your Umbrel Recipes app. Check the URL and that the app is running.",
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FORMAT_RECIPE") {
    formatRecipe(message.rawData)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err?.message || "Unexpected error calling Grok.",
        });
      });
    return true;
  }

  if (message?.type === "SAVE_TO_UMBREL") {
    saveToUmbrel(message.recipe)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err?.message || "Unexpected error saving to Umbrel.",
        });
      });
    return true;
  }

  if (message?.type === "CHECK_RECIPE_BLOCKED") {
    getSettings()
      .then((settings) =>
        checkRecipeBlocked(settings.umbrelUrl, settings.umbrelToken, message.sourceUrl || "")
      )
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          blocked: false,
          error: err?.message || "Could not check the blocklist.",
        });
      });
    return true;
  }

  if (message?.type === "GET_UMBREL_STATUS") {
    getSettings()
      .then(async (settings) => {
        const configured = Boolean(settings.umbrelUrl && settings.umbrelToken);
        const permitted = configured ? await hasUmbrelPermission(settings.umbrelUrl) : false;
        sendResponse({ configured, permitted, umbrelUrl: settings.umbrelUrl });
      })
      .catch(() => sendResponse({ configured: false, permitted: false }));
    return true;
  }

  if (message?.type === "GET_EXTENSION_STATUS") {
    getSettings()
      .then((settings) => {
        sendResponse({
          hasApiKey: Boolean(settings.apiKey),
          umbrelConfigured: Boolean(settings.umbrelUrl && settings.umbrelToken),
          umbrelHasApiKey: settings.umbrelHasApiKey,
          configError: settings.configError,
        });
      })
      .catch(() =>
        sendResponse({
          hasApiKey: false,
          umbrelConfigured: false,
          umbrelHasApiKey: false,
          configError: null,
        }),
      );
    return true;
  }

  return undefined;
});