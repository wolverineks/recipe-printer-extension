const MAX_TEXT_LENGTH = 12000;

function isRecipeType(type) {
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) => typeof t === "string" && t.toLowerCase().includes("recipe")
  );
}

function findRecipeInJsonLd(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  if (isRecipeType(node["@type"])) return node;
  if (node["@graph"]) return findRecipeInJsonLd(node["@graph"]);
  return null;
}

function extractJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const recipe = findRecipeInJsonLd(data);
      if (recipe) return recipe;
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return null;
}

function textFromNode(node) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim();
}

function listFromNodes(nodes) {
  return [...nodes]
    .map((node) => textFromNode(node))
    .filter(Boolean);
}

function extractMicrodata() {
  const root = document.querySelector('[itemtype*="schema.org/Recipe"]');
  if (!root) return null;

  const title =
    textFromNode(root.querySelector('[itemprop="name"]')) ||
    textFromNode(root.querySelector("h1"));

  const ingredients = listFromNodes(
    root.querySelectorAll('[itemprop="recipeIngredient"]')
  );

  const instructionNodes = root.querySelectorAll(
    '[itemprop="recipeInstructions"] li, [itemprop="recipeInstructions"] p, [itemprop="recipeInstructions"]'
  );

  let instructions = listFromNodes(instructionNodes);
  if (instructions.length === 1 && instructions[0].length > 200) {
    instructions = instructions[0]
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return {
    title,
    description: textFromNode(root.querySelector('[itemprop="description"]')),
    servings: textFromNode(root.querySelector('[itemprop="recipeYield"]')),
    prep_time: textFromNode(root.querySelector('[itemprop="prepTime"]')),
    cook_time: textFromNode(root.querySelector('[itemprop="cookTime"]')),
    total_time: textFromNode(root.querySelector('[itemprop="totalTime"]')),
    ingredients,
    instructions,
  };
}

function pickMainElement() {
  const selectors = [
    '[itemtype*="schema.org/Recipe"]',
    '[itemprop="recipe"]',
    "article .recipe",
    "article",
    ".recipe-content",
    ".recipe-card",
    ".recipe",
    "#recipe",
    "main",
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && textFromNode(el).length > 120) return el;
  }

  return document.body;
}

function truncate(text, max = MAX_TEXT_LENGTH) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated]`;
}

function serializeJsonLd(recipe) {
  if (!recipe) return "";
  const fields = [
    "name",
    "description",
    "recipeYield",
    "prepTime",
    "cookTime",
    "totalTime",
    "recipeIngredient",
    "recipeInstructions",
  ];

  const lines = [];
  for (const field of fields) {
    const value = recipe[field];
    if (!value) continue;
    if (Array.isArray(value)) {
      lines.push(`${field}:`);
      for (const item of value) {
        if (typeof item === "string") {
          lines.push(`- ${item}`);
        } else if (item?.text) {
          lines.push(`- ${item.text}`);
        } else if (item?.name) {
          lines.push(`- ${item.name}`);
        }
      }
    } else if (typeof value === "string") {
      lines.push(`${field}: ${value}`);
    } else if (value?.text) {
      lines.push(`${field}: ${value.text}`);
    }
  }
  return lines.join("\n");
}

function extractRecipe() {
  const url = window.location.href;
  const title = document.title.replace(/\s*[-|].*$/, "").trim();
  const jsonLd = extractJsonLd();
  const microdata = extractMicrodata();

  let extractionMethod = "heuristic";
  let text = "";

  if (jsonLd) {
    extractionMethod = "json-ld";
    text = serializeJsonLd(jsonLd);
  } else if (microdata) {
    extractionMethod = "microdata";
    text = [
      microdata.title && `Title: ${microdata.title}`,
      microdata.description && `Description: ${microdata.description}`,
      microdata.servings && `Servings: ${microdata.servings}`,
      microdata.prep_time && `Prep: ${microdata.prep_time}`,
      microdata.cook_time && `Cook: ${microdata.cook_time}`,
      microdata.total_time && `Total: ${microdata.total_time}`,
      microdata.ingredients.length &&
        `Ingredients:\n${microdata.ingredients.map((i) => `- ${i}`).join("\n")}`,
      microdata.instructions.length &&
        `Instructions:\n${microdata.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (!text) {
    const main = pickMainElement();
    text = (main?.innerText || "").trim();
  }

  text = truncate(text);

  if (!text || text.length < 40) {
    return {
      ok: false,
      error: "No recipe content found on this page.",
    };
  }

  return {
    ok: true,
    data: {
      title,
      url,
      jsonLd,
      text,
      extractionMethod,
    },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "EXTRACT_RECIPE") return;
  sendResponse(extractRecipe());
  return true;
});