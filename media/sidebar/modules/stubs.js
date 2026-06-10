import { vscode } from "./vscode.js";
import { getActivePort } from "./tabs.js";
import { attachTooltip } from "./tooltip.js";

const statusTooltip = document.getElementById("status-tooltip");

document.querySelectorAll(".status-info[data-tooltip]").forEach((el) => {
  const text = el.dataset.tooltip;
  if (!text) {
    return;
  }
  attachTooltip(el, text);
});

const advancedToggle = document.getElementById("advanced-options-toggle");
const advancedBody = document.getElementById("advanced-options-body");

advancedToggle.addEventListener("click", () => {
  const expanded = advancedToggle.getAttribute("aria-expanded") === "true";
  advancedToggle.setAttribute("aria-expanded", String(!expanded));
  advancedBody.hidden = expanded;
});

document.getElementById("gen-lib-stubs-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "generateLibraryStubs", port: getActivePort() });
});
