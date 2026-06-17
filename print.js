const recipeEl = document.getElementById("recipe");
const errorEl = document.getElementById("error");
const titleEl = document.getElementById("title");
const descriptionEl = document.getElementById("description");
const metaEl = document.getElementById("meta");
const ingredientsEl = document.getElementById("ingredients");
const instructionsEl = document.getElementById("instructions");
const notesSection = document.getElementById("notes-section");
const notesEl = document.getElementById("notes");
const sourceEl = document.getElementById("source");
const printedOnEl = document.getElementById("printed-on");
const printBtn = document.getElementById("print-btn");
const closeBtn = document.getElementById("close-btn");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function addMeta(label, value) {
  if (!value) return;
  const item = document.createElement("li");
  item.textContent = `${label}: ${value}`;
  metaEl.appendChild(item);
}

function renderRecipe(recipe) {
  titleEl.textContent = recipe.title || "Untitled Recipe";

  if (recipe.description) {
    descriptionEl.textContent = recipe.description;
    descriptionEl.classList.remove("hidden");
  } else {
    descriptionEl.classList.add("hidden");
  }

  addMeta("Servings", recipe.servings);
  addMeta("Prep", recipe.prep_time);
  addMeta("Cook", recipe.cook_time);
  addMeta("Total", recipe.total_time);

  for (const ingredient of recipe.ingredients || []) {
    const li = document.createElement("li");
    li.textContent = ingredient;
    ingredientsEl.appendChild(li);
  }

  for (const step of recipe.instructions || []) {
    const li = document.createElement("li");
    li.textContent = step;
    instructionsEl.appendChild(li);
  }

  if (recipe.notes) {
    notesEl.textContent = recipe.notes;
    notesSection.classList.remove("hidden");
  }

  if (recipe.source_url) {
    sourceEl.textContent = `Source: ${recipe.source_url}`;
  }

  printedOnEl.textContent = `Printed: ${new Date().toLocaleDateString()}`;
  recipeEl.classList.remove("hidden");
}

async function init() {
  const { printRecipe } = await chrome.storage.session.get("printRecipe");
  if (!printRecipe) {
    showError("No recipe data found. Run Format & Print from the extension popup.");
    return;
  }

  renderRecipe(printRecipe);

  const shouldAutoPrint = new URLSearchParams(window.location.search).get("auto") === "1";
  if (shouldAutoPrint) {
    window.addEventListener("load", () => {
      setTimeout(() => window.print(), 250);
    });
  }
}

printBtn.addEventListener("click", () => window.print());
closeBtn.addEventListener("click", () => window.close());

init();