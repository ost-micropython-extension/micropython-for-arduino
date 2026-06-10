import { vscode } from "./vscode.js";
import { getActivePort } from "./tabs.js";
import { attachTooltip, hideTooltip } from "./tooltip.js";

const uninstallButton = document.getElementById("uninstall-btn");
const installedList = document.getElementById("installed-list");

const librarySearch = document.getElementById("library-search");
const libraryList = document.getElementById("library-list");
const installButton = document.getElementById("install-btn");
const customUrlInput = document.getElementById("custom-url-input");
const customInstallButton = document.getElementById("custom-install-btn");

const collapseToggle = document.getElementById("lib-install-toggle");
const collapseBody = document.getElementById("lib-install-body");

collapseToggle.addEventListener("click", () => {
  const expanded = collapseToggle.getAttribute("aria-expanded") === "true";
  collapseToggle.setAttribute("aria-expanded", String(!expanded));
  collapseBody.hidden = expanded;
});

let selectedInstalledLib = null;
let allLibraries = [];
let selectedLibrary = null;
let boardBlocked = false;

uninstallButton.addEventListener("click", () => {
  if (!selectedInstalledLib) {
    return;
  }
  uninstallButton.disabled = true;
  vscode.postMessage({
    type: "uninstallLibrary",
    id: selectedInstalledLib.name,
    displayName: selectedInstalledLib.displayName,
    port: getActivePort(),
  });
});

customInstallButton.addEventListener("click", () => {
  const url = customUrlInput.value.trim();
  if (!url) {
    return;
  }
  customInstallButton.disabled = true;
  vscode.postMessage({
    type: "installLibrary",
    name: url,
    url,
    port: getActivePort(),
  });
});

customUrlInput.addEventListener("input", () => {
  updateCustomInstallButton();
});

librarySearch.addEventListener("input", () => {
  renderLibraryList(filterLibraries(librarySearch.value));
});

installButton.addEventListener("click", () => {
  if (!selectedLibrary) {
    return;
  }
  installButton.disabled = true;
  vscode.postMessage({
    type: "installLibrary",
    url: selectedLibrary.url,
    name: selectedLibrary.name,
    port: getActivePort(),
  });
});

/**
 * Renders list with installed libraries on the current board.
 */
export function updateInstalledList(libs) {
  installedList.innerHTML = "";
  selectedInstalledLib = null;
  uninstallButton.disabled = true;

  if (!libs || !libs.length) {
    const li = document.createElement("li");
    li.textContent = "No libraries installed.";
    li.classList.add("empty");
    installedList.appendChild(li);
    return;
  }
  libs.forEach((lib) => {
    const li = document.createElement("li");
    const icon = lib.isDir ? "📁" : "📄";
    const label = lib.displayName || lib.name;
    const version = lib.version ? ` v${lib.version}` : "";
    li.textContent = `${icon} ${label}${version}`;
    const tooltipParts = [`Datei: ${lib.name}`];
    if (lib.url) {
      tooltipParts.push(lib.url);
    }
    if (lib.installedAt) {
      tooltipParts.push(`Installiert: ${lib.installedAt}`);
    }
    attachTooltip(li, tooltipParts.join("\n"));
    li.addEventListener("click", () => {
      hideTooltip();
      installedList
        .querySelectorAll("li")
        .forEach((el) => el.classList.remove("selected"));
      li.classList.add("selected");
      selectedInstalledLib = lib;
      uninstallButton.disabled = boardBlocked;
    });
    installedList.appendChild(li);
  });
}

export function handleUninstallResult(message) {
  if (!message.success) {
    uninstallButton.disabled = boardBlocked || selectedInstalledLib === null;
  }
}

export function updateLibraries(libs) {
  allLibraries = libs;
  librarySearch.disabled = false;
  librarySearch.value = "";
  renderLibraryList(allLibraries);
}

export function handleInstallResult() {
  installButton.disabled = boardBlocked || selectedLibrary === null;
  customInstallButton.disabled = boardBlocked;
}

export function setBoardBlocked(blocked) {
  boardBlocked = blocked;

  uninstallButton.disabled = boardBlocked || selectedInstalledLib === null;
  installButton.disabled = boardBlocked || selectedLibrary === null;
  updateCustomInstallButton();
}

function updateCustomInstallButton() {
  customInstallButton.disabled = boardBlocked || !customUrlInput.value;
}

function filterLibraries(search) {
  const q = search.trim().toLowerCase();
  if (!q) {
    return allLibraries;
  }
  return allLibraries.filter(
    (lib) =>
      lib.name.toLowerCase().includes(q) ||
      lib.description.toLowerCase().includes(q) ||
      lib.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

function renderLibraryList(libs) {
  libraryList.innerHTML = "";
  selectedLibrary = null;
  installButton.disabled = true;

  if (!libs || !libs.length) {
    const li = document.createElement("li");
    li.textContent = allLibraries.length
      ? "No results."
      : "No packages loaded yet.";
    li.classList.add("empty");
    libraryList.appendChild(li);
    return;
  }

  libs.forEach((lib) => {
    const li = document.createElement("li");

    const nameEl = document.createElement("div");
    nameEl.className = "lib-name";
    nameEl.textContent = lib.name;

    const descEl = document.createElement("div");
    descEl.className = "lib-desc";
    descEl.textContent = lib.description || lib.author || "";

    li.appendChild(nameEl);
    li.appendChild(descEl);
    attachTooltip(
      li,
      [
        lib.description,
        lib.author ? `Autor: ${lib.author}` : "",
        lib.tags.length ? `Tags: ${lib.tags.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    li.addEventListener("click", () => {
      hideTooltip();
      libraryList
        .querySelectorAll("li")
        .forEach((el) => el.classList.remove("selected"));
      li.classList.add("selected");
      selectedLibrary = lib;
      installButton.disabled = boardBlocked;
    });

    libraryList.appendChild(li);
  });
}
