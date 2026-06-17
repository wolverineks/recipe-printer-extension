export const RECIPE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Recipe title" },
    description: {
      type: ["string", "null"],
      description: "Short description or null",
    },
    servings: {
      type: ["string", "null"],
      description: "Servings/yield as written, or null",
    },
    prep_time: {
      type: ["string", "null"],
      description: "Prep time as written, or null",
    },
    cook_time: {
      type: ["string", "null"],
      description: "Cook time as written, or null",
    },
    total_time: {
      type: ["string", "null"],
      description: "Total time as written, or null",
    },
    ingredients: {
      type: "array",
      items: { type: "string" },
      description: "Ingredient lines with quantities",
    },
    instructions: {
      type: "array",
      items: { type: "string" },
      description: "Step-by-step instructions",
    },
    notes: {
      type: ["string", "null"],
      description: "Tips or notes, or null",
    },
    source_url: { type: "string", description: "Original page URL" },
  },
  required: [
    "title",
    "description",
    "servings",
    "prep_time",
    "cook_time",
    "total_time",
    "ingredients",
    "instructions",
    "notes",
    "source_url",
  ],
  additionalProperties: false,
};

export const SYSTEM_PROMPT = `You normalize messy recipe webpage content into a clean, printable recipe.

Rules:
- Preserve quantities, units, and ingredient names faithfully.
- Deduplicate repeated ingredients.
- Split combined instruction blobs into clear, actionable steps.
- Use null for missing optional fields instead of guessing.
- Keep the original source_url from the user message.
- If the page does not contain a recipe, return a best-effort extraction and note uncertainty in description.`;