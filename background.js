import { RECIPE_JSON_SCHEMA, SYSTEM_PROMPT } from "./recipe-schema.js";

const DEFAULT_MODEL = "grok-4-1-fast";

function normalizeUmbrelUrl(value) {
  let trimmed = (value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  trimmed = trimmed.replace(/\/api\/ingest$/i, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed.replace(/\/+$/, "");
}

async function getSettings() {
  const { apiKey, model, umbrelUrl, umbrelToken } = await chrome.storage.local.get([
    "apiKey",
    "model",
    "umbrelUrl",
    "umbrelToken",
  ]);
  return {
    apiKey: apiKey || "",
    model: model || DEFAULT_MODEL,
    umbrelUrl: normalizeUmbrelUrl(umbrelUrl),
    umbrelToken: (umbrelToken || "").trim(),
  };
}

async function hasUmbrelPermission(umbrelUrl) {
  if (!umbrelUrl) return false;
  try {
    const origin = new URL(umbrelUrl).origin;
    return chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
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
    return { ok: false, error: "API key not set. Open extension options to add your xAI key." };
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
      return { ok: false, error: "Invalid API key. Check your xAI key in Options." };
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
  const { umbrelUrl, umbrelToken } = await getSettings();

  if (!umbrelUrl && !umbrelToken) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }
  if (!umbrelUrl || !umbrelToken) {
    return {
      ok: false,
      error: "Umbrel is partially configured. Add both URL and ingest token in extension Settings.",
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
      const body = await response.text();
      return {
        ok: false,
        error: `Umbrel save failed (${response.status}): ${body.slice(0, 160)}`,
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

  return undefined;
});