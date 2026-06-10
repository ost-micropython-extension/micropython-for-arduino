import { getActivePort } from "./tabs.js";
import { attachTooltip, hideTooltip } from "./tooltip.js";
import { vscode } from "./vscode.js";

/**
 * Render Card for given code support item.
 */
function buildCard(item) {
  const card = document.createElement("div");
  card.className = "codesupport-card";

  const name = document.createElement("span");
  name.className = "codesupport-name";
  name.textContent = item.displayName;

  const instBadge = document.createElement("span");
  instBadge.className = "codesupport-badge " + (item.installed ? "ok" : "nok");
  instBadge.innerHTML = item.installed ? "Installed" : "Not Installed";
  attachTooltip(
    instBadge,
    item.installed
      ? "Library is installed on current board"
      : getActivePort()
        ? "Library is not installed on current board"
        : "No board connected",
  );

  const codeBadge = document.createElement("span");
  codeBadge.className =
    "codesupport-badge " + (item.codesupport ? "ok" : "nok");
  codeBadge.innerHTML = item.codesupport ? "Code Support" : "No Code Support";
  attachTooltip(
    codeBadge,
    item.codesupport
      ? "The current workspace contains library files for suggestions and code support."
      : "No library files found in this workspace. Try regenerating code support.",
  );

  const label = document.createElement("label");
  label.className = "toggle";
  if (item.codesupport) {
    attachTooltip(
      label,
      `Code Support for ${item.displayName} is ${item.active ? "active" : "deactivated"}`,
    );
  } else {
    attachTooltip(label, `No Code Support available for ${item.displayName}`);
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.active && item.codesupport;
  checkbox.disabled = !item.codesupport;

  const track = document.createElement("span");
  track.className = "toggle-track";

  const thumb = document.createElement("span");
  thumb.className = "toggle-thumb";

  checkbox.addEventListener("change", () => {
    hideTooltip();
    if (checkbox.checked) {
      vscode.postMessage({
        type: "activateCodeSupport",
        name: item.displayName,
      });
      attachTooltip(label, `Code Support for ${item.displayName} is active`);
    } else {
      vscode.postMessage({
        type: "deactivateCodeSupport",
        name: item.displayName,
      });
      attachTooltip(
        label,
        `Code Support for ${item.displayName} is deactivated`,
      );
    }
  });

  label.appendChild(checkbox);
  label.appendChild(track);
  label.appendChild(thumb);

  card.appendChild(name);
  card.appendChild(instBadge);
  card.appendChild(codeBadge);
  card.appendChild(label);

  return card;
}

/**
 * Renders cards for each given library item.
 * Shows if library is installed on the board and if code support folder exists.
 * User can activate / deactivate code support for each library.
 */
export function updateCodeSupport(items) {
  const container = document.getElementById("codesupport-list");
  if (!container) {
    console.error("codesupport-list not found");
    return;
  }
  container.innerHTML = items.length === 0 ? "No libraries found" : "";

  const list = document.createElement("div");
  list.className = "codesupport-list";

  items.forEach((item) => list.appendChild(buildCard(item)));

  container.appendChild(list);
}
