import { attachTooltip, hideTooltip } from "./tooltip.js";
import { vscode } from "./vscode.js";

const tabBar = document.getElementById("tab-bar");
const addButton = document.getElementById("tab-add-btn");
const addMenu = document.getElementById("tab-add-menu");
const boardName = document.getElementById("active-board-name");
const disconnectButton = document.getElementById("disconnect-btn");

attachTooltip(addButton, "Connect a Board");

let _availablePorts = [];
let _openPorts = [];
let _activePort = null;
let _pendingAutoConnect = false;
const _switchCallbacks = [];
const _closeCallbacks = [];

/**
 * Returns name of currently opened port.
 */
export function getActivePort() {
  return _activePort;
}

/**
 * Called when the extension pushes a fresh port list.
 * Closes any open tabs whose port has disappeared.
 */
export function updateAvailablePorts(ports) {
  _availablePorts = ports
    ? ports.filter((port) => port.boardName && port.path)
    : [];
  _rebuildAddMenu();

  const paths = new Set(_availablePorts.map((p) => p.path));
  const disappeared = _openPorts.filter((p) => !paths.has(p));
  disappeared.forEach((port) => _closeTab(port));

  if (_pendingAutoConnect) {
    _pendingAutoConnect = false;
    const unconnected = _availablePorts.filter(
      (p) => !_openPorts.includes(p.path),
    );
    if (unconnected.length === 1) {
      openTab(unconnected[0].path);
      _closeAddMenu();
    }
  }
}

/**
 * Open the tab for the given port path.
 */
export function openTab(port) {
  if (_openPorts.includes(port)) {
    _switchTo(port);
    return;
  }
  vscode.postMessage({ type: "openPort", port });
  _openPorts.push(port);
  _renderTabs();
  _switchTo(port);
  vscode.postMessage({ type: "getBoardFiles", port });
}

/**
 * Close the tab for the given port, e.g. when the extension reports
 * that connecting to the port failed.
 */
export function closeTab(port) {
  if (_openPorts.includes(port)) {
    _closeTab(port);
  }
}

/**
 * Register a callback that fires whenever the active tab changes.
 * cb(newPort: string | null)
 */
export function onTabSwitch(cb) {
  _switchCallbacks.push(cb);
}

/**
 * Register a callback that fires just before a tab is closed.
 * cb(closedPort: string)
 */
export function onTabClose(cb) {
  _closeCallbacks.push(cb);
}

/**
 * Changes active tab to port.
 */
function _switchTo(port) {
  _activePort = port;
  _renderTabs();
  _switchCallbacks.forEach((cb) => cb(port));

  const portInfo = _availablePorts.find((p) => p.path === port);
  boardName.textContent = portInfo?.boardName ?? "";
  boardName.hidden = false;
  vscode.postMessage({ type: "setCurrent", port: port });
}

/**
 * Removes port from open tabs and calls close callbacks.
 * Opens next tab if available.
 */
function _closeTab(port) {
  _closeCallbacks.forEach((cb) => cb(port));

  _openPorts = _openPorts.filter((p) => p !== port);

  if (_activePort === port) {
    const next = _openPorts.at(-1) ?? null;
    _activePort = next;
    _switchCallbacks.forEach((cb) => cb(next));

    if (!next) {
      boardName.textContent = "";
      boardName.hidden = true;
      addButton.textContent = "Connect Board";
      addButton.className = "fullwidth-btn";
      vscode.postMessage({ type: "setCurrent", port: undefined });
    } else {
      boardName.hidden = false;
      boardName.textContent = _availablePorts.find(
        (port) => port.path === next,
      ).boardName;
      vscode.postMessage({ type: "setCurrent", port: next });
    }
  }

  vscode.postMessage({ type: "closePort", port });
  _renderTabs();
}

/**
 * Rendering function for all tabs.
 */
function _renderTabs() {
  tabBar.querySelectorAll(".port-tab").forEach((el) => el.remove());

  _openPorts.forEach((port) => {
    const portInfo = _availablePorts.find((p) => p.path === port);
    const label = port;

    const tab = document.createElement("button");
    tab.className =
      "port-tab" + (_activePort === port ? " port-tab--active" : "");
    tab.type = "button";
    attachTooltip(tab, port);

    const labelSpan = document.createElement("span");
    labelSpan.className = "port-tab-label";
    labelSpan.textContent = label;

    const closeBtn = document.createElement("span");
    closeBtn.className = "port-tab-close";
    closeBtn.textContent = "×";
    attachTooltip(closeBtn, "Disconnect");
    closeBtn.setAttribute("role", "button");
    closeBtn.setAttribute("aria-label", `Disconnect ${label}`);

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideTooltip();
      _closeTab(port);
    });

    tab.appendChild(labelSpan);
    tab.appendChild(closeBtn);
    tab.addEventListener("click", () => _switchTo(port));

    tabBar.insertBefore(tab, addButton);
  });
}

/**
 * Rendering function for port dropdown.
 */
function _rebuildAddMenu() {
  addMenu.innerHTML = "";

  const unconnected = _availablePorts.filter(
    (p) => !_openPorts.includes(p.path),
  );

  if (!unconnected.length) {
    const li = document.createElement("li");
    li.className = "tab-add-menu-item tab-add-menu-item--empty";
    li.textContent = _availablePorts.length
      ? "All found ports already open"
      : "No devices found";
    addMenu.appendChild(li);
    return;
  }

  unconnected.forEach((port) => {
    const li = document.createElement("li");
    li.className = "tab-add-menu-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-add-menu-name";
    nameSpan.textContent = port.boardName ?? port.path;

    const pathSpan = document.createElement("span");
    pathSpan.className = "tab-add-menu-path";
    pathSpan.textContent = port.boardName ? port.path : "";
    pathSpan.hidden = !port.boardName;

    li.appendChild(nameSpan);
    li.appendChild(pathSpan);
    li.addEventListener("click", () => {
      openTab(port.path);
      _closeAddMenu();
    });
    addMenu.appendChild(li);
  });
}

/**
 * Hides the port dropdown and syncs the add button to the current tab
 * state ("+" once at least one tab is open, "Connect Board" otherwise).
 */
function _closeAddMenu() {
  addMenu.hidden = true;
  addButton.setAttribute("aria-expanded", "false");
  if (_openPorts.length > 0) {
    addButton.innerText = "+";
    addButton.className = "tab-add-btn";
  } else {
    addButton.textContent = "Connect Board";
    addButton.className = "fullwidth-btn";
  }
}

addButton.addEventListener("click", async () => {
  hideTooltip();
  const willOpen = addMenu.hidden;
  addMenu.hidden = !willOpen;
  addButton.setAttribute("aria-expanded", String(!willOpen));
  _pendingAutoConnect = willOpen;

  if (willOpen) {
    vscode.postMessage({ type: "getPorts" });
  }
});

disconnectButton.addEventListener("click", async () => {
  _closeTab(getActivePort());
});

document.addEventListener("click", (e) => {
  if (!addButton.contains(e.target) && !addMenu.contains(e.target)) {
    _closeAddMenu();
    _pendingAutoConnect = false;
  }
});
