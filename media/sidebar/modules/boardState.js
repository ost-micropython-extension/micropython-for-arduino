import { attachTooltip, detachTooltip, hideTooltip } from "./tooltip.js";
import { ACTION_ICONS } from "./filetree/constants.js";

const elementsToHide = document.querySelectorAll(".hidden-when-disconnected");
const mountTooltips = Array.from(
  document.getElementsByClassName("disabled-while-mount-tooltip"),
);

const runButton = document.getElementById("run-btn");
const runSelectionButton = document.getElementById("run-selection-btn");
const connectButton = document.getElementById("connect-btn");
const stopButton = document.getElementById("stop-btn");
const softResetButton = document.getElementById("soft-reset-btn");

const mountButton = document.getElementById("mount-btn");
const boardfileTree = document.getElementById("boardfiles-tree");
const boardfileMessage = document.getElementById("boardfiles-mount-message");

const stubGenButton = document.getElementById("gen-lib-stubs-btn");

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const statusInfo = document.getElementById("status-info");

const STATUS_TOOLTIPS = {
  ready: "Board is ready. You can run a script or open the REPL console.",
  repl: "REPL is open and using the port.",
  mount: "Workspace is mounted as a temporary filesystem on the board.",
  running: "A script is currently running.",
  busy: "Port is in use by the extension.",
  disconnected:
    "No board selected. Click on Connect Board to establish a connection.",
};

/**
 * Reset the status panel to a neutral disconnected state.
 * Called when switching to a tab whose state we don't know yet,
 * or when no tab is open at all.
 */
export function resetStatus() {
  statusDot.classList.remove("connected", "busy");
  statusText.textContent = "Disconnected";
  attachTooltip(statusInfo, STATUS_TOOLTIPS.disconnected);

  elementsToHide.forEach((el) => {
    el.style.display = "none";
  });

  runButton.disabled = true;
  runSelectionButton.disabled = true;
  connectButton.disabled = true;
  stopButton.disabled = true;
  softResetButton.disabled = true;
  mountButton.disabled = true;
  stubGenButton.disabled = true;
}

/**
 * Updates all components that availability or content depends on the current board state.
 */
export function updateStatus(boardState) {
  const connected = boardState.connected;
  const mountActive = boardState.mountActive;
  const replOpen = boardState.replOpen;
  const fileOpsActive = boardState.fileOpsActive;
  const running = boardState.running;
  statusDot.classList.remove("connected", "busy");

  let key;
  if (!connected) {
    key = "disconnected";
  } else if (replOpen) {
    key = "repl";
  } else if (mountActive) {
    key = "mount";
  } else if (running) {
    key = "running";
  } else if (fileOpsActive) {
    key = "busy";
  } else {
    key = "ready";
  }

  attachTooltip(statusInfo, STATUS_TOOLTIPS[key] ?? "");

  switch (key) {
    case "ready":
      statusDot.classList.add("connected");
      statusText.textContent = "Ready";
      break;
    case "repl":
      statusDot.classList.add("busy");
      statusText.textContent = "REPL";
      break;
    case "mount":
      statusDot.classList.add("busy");
      statusText.textContent = "Mount";
      break;
    case "running":
      statusDot.classList.add("busy");
      statusText.textContent = "Running";
      break;
    case "busy":
      statusDot.classList.add("busy");
      statusText.textContent = "In Use";
      break;
    default:
      statusText.textContent = "Disconnected";
  }

  // Hide when not connected
  elementsToHide.forEach((el) => {
    el.style.display = connected ? "" : "none";
  });

  // Board Actions
  runButton.disabled = fileOpsActive || running;
  runSelectionButton.disabled = fileOpsActive || running;
  connectButton.disabled = fileOpsActive || running || mountActive;
  stopButton.disabled = fileOpsActive;
  softResetButton.disabled = fileOpsActive || running;

  // Mount
  mountButton.innerHTML = mountActive
    ? `${ACTION_ICONS.unmount} Unmount`
    : `${ACTION_ICONS.mount} Mount Folder`;
  mountButton.disabled =
    fileOpsActive || running || mountButton.dataset.locked === "true";

  // Stubs
  stubGenButton.disabled = fileOpsActive || running || mountActive;

  if (boardState.mountActive) {
    boardfileTree.style.display = "none";
    boardfileMessage.style.display = "block";
    mountTooltips.forEach((el) => attachTooltip(el, "Disabled while mounted"));
    mountButton.dataset.locked = "true";
    mountButton.disabled = true;
    setTimeout(() => {
      delete mountButton.dataset.locked;
      mountButton.disabled = false;
    }, 4000);
  } else {
    boardfileTree.style.display = connected ? "block" : "none";
    boardfileMessage.style.display = "none";
    mountTooltips.forEach((el) => detachTooltip(el));
  }
}
