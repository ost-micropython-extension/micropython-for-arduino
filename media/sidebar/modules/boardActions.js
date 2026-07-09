import { vscode } from "./vscode.js";
import { getActivePort } from "./tabs.js";
import { attachTooltip, detachTooltip } from "./tooltip.js";

const runIcon = `<svg class="btn-icon" viewBox="-3 0 28 28" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <g stroke="none" stroke-width="1" fill="currentColor" fill-rule="evenodd">
    <g transform="translate(-417.000000, -569.000000)" fill="currentColor">
      <path d="M418.983,594.247 L418.983,571.722 L436.831,582.984 L418.983,594.247 L418.983,594.247 Z M438.204,581.536 L419.394,569.279 C418.278,568.672 417,568.943 417,570.917 L417,595.052 C417,597.012 418.371,597.361 419.394,596.689 L438.204,584.433 C439.288,583.665 439.258,582.242 438.204,581.536 L438.204,581.536 Z"/>
    </g>
  </g>
</svg>`;
const runSelectionIcon = `<svg class="btn-icon" viewBox="-3 0 28 28" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="2,6 0,14 2,22"/>
    <polyline points="20,6 22,14 20,22"/>
    <polygon points="7,6 17,14 7,22"/>
  </g>
</svg>`;
const connectIcon = `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M3.21967 4.46967C3.51256 4.17678 3.98744 4.17678 4.28033 4.46967L11.2803 11.4697C11.5732 11.7626 11.5732 12.2374 11.2803 12.5303L4.28033 19.5303C3.98744 19.8232 3.51256 19.8232 3.21967 19.5303C2.92678 19.2374 2.92678 18.7626 3.21967 18.4697L9.68934 12L3.21967 5.53033C2.92678 5.23744 2.92678 4.76256 3.21967 4.46967Z" fill="currentColor"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M9.25 19C9.25 18.5858 9.58579 18.25 10 18.25H20.25C20.6642 18.25 21 18.5858 21 19C21 19.4142 20.6642 19.75 20.25 19.75H10C9.58579 19.75 9.25 19.4142 9.25 19Z" fill="currentColor"/>
</svg>`;
const softResetIcon = `<svg class="btn-icon" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" fill-rule="evenodd" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="matrix(0 1 1 0 2.5 2.5)">
    <path d="m3.98652376 1.07807068c-2.38377179 1.38514556-3.98652376 3.96636605-3.98652376 6.92192932 0 4.418278 3.581722 8 8 8s8-3.581722 8-8-3.581722-8-8-8"/>
    <path d="m4 1v4h-4" transform="matrix(1 0 0 -1 0 6)"/>
  </g>
</svg>`;
const stopIcon = `<svg class="btn-icon" viewBox="0 0 1920 1920" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M1920 0v1920H0V0h1920Zm-137.143 137.143H137.143v1645.714h1645.714V137.143Z" fill-rule="evenodd"/>
</svg>`;
const disconnectIcon = `<svg class="btn-icon" width="800px" height="800px" viewBox="0 0 28 28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M22.7399 6.32717C24.3781 8.48282 24.2132 11.571 22.2453 13.5389L20.3007 15.4835C20.0078 15.7764 19.533 15.7764 19.2401 15.4835L12.5226 8.76595C12.2297 8.47306 12.2297 7.99818 12.5226 7.70529L14.4671 5.76075C16.4352 3.79268 19.5237 3.62792 21.6793 5.26646L24.7238 2.22166C25.0167 1.92875 25.4916 1.92873 25.7845 2.22161C26.0774 2.51449 26.0774 2.98936 25.7845 3.28227L22.7399 6.32717Z" fill="currentColor"/>
  <path d="M12.7778 12.2757C13.0707 11.9828 13.0707 11.5079 12.7778 11.215C12.485 10.9221 12.0101 10.9221 11.7172 11.215L9.59085 13.3413L8.76851 12.5189C8.47561 12.226 8.00074 12.226 7.70785 12.5189L5.7633 14.4635C3.79537 16.4314 3.6305 19.5196 5.26867 21.6752L2.22404 24.7202C1.93116 25.0131 1.93118 25.488 2.22409 25.7808C2.517 26.0737 2.99187 26.0737 3.28475 25.7808L6.32928 22.736C8.48495 24.3745 11.5734 24.2097 13.5415 22.2416L15.486 20.2971C15.7789 20.0042 15.7789 19.5293 15.486 19.2364L14.6589 18.4093L16.7842 16.284C17.0771 15.9912 17.0771 15.5163 16.7842 15.2234C16.4913 14.9305 16.0164 14.9305 15.7235 15.2234L13.5982 17.3486L10.6515 14.4019L12.7778 12.2757Z" fill="currentColor"/>
</svg>`;

const buttonContainer = document.getElementById("button-group");
const modeToggle = document.getElementById("btn-view-toggle");

const connectButton = document.getElementById("connect-btn");
const runButton = document.getElementById("run-btn");
const stopButton = document.getElementById("stop-btn");
const softResetButton = document.getElementById("soft-reset-btn");
const runSelectionButton = document.getElementById("run-selection-btn");
const disconnectButton = document.getElementById("disconnect-btn");

const allButtons = [
  runButton,
  runSelectionButton,
  stopButton,
  connectButton,
  softResetButton,
  disconnectButton,
];

function setMode(iconOnly) {
  buttonContainer.className = iconOnly ? "button-row" : "button-column";
  allButtons.forEach((btn) => {
    btn.className = iconOnly ? "icon-btn" : "fullwidth-btn";
  });
  disconnectButton.classList.add("secondary");

  connectButton.innerHTML = connectIcon + (iconOnly ? "" : "Open REPL Console");
  runButton.innerHTML = runIcon + (iconOnly ? "" : "Run current File");
  runSelectionButton.innerHTML =
    runSelectionIcon + (iconOnly ? "" : "Run Selection");
  softResetButton.innerHTML = softResetIcon + (iconOnly ? "" : "Soft Reset");
  stopButton.innerHTML = stopIcon + (iconOnly ? "" : "Stop");
  disconnectButton.innerHTML =
    disconnectIcon + (iconOnly ? "" : "Disconnect Board");

  if (iconOnly) {
    attachTooltip(connectButton, "Open REPL Console");
    attachTooltip(runButton, "Run current File");
    attachTooltip(runSelectionButton, "Run Selection");
    attachTooltip(softResetButton, "Soft Reset");
    attachTooltip(stopButton, "Stop");
    attachTooltip(disconnectButton, "Disconnect Board");
  } else {
    allButtons.forEach(detachTooltip);
  }

  vscode.setState({ iconOnly });
}

modeToggle.addEventListener("change", () => setMode(modeToggle.checked));

const saved = vscode.getState();
if (saved?.iconOnly) {
  modeToggle.checked = true;
  setMode(true);
} else {
  modeToggle.checked = false;
  setMode(false);
}

connectButton.addEventListener("click", () => {
  vscode.postMessage({ type: "connect", port: getActivePort() });
});

runButton.addEventListener("click", () => {
  vscode.postMessage({ type: "runFile", port: getActivePort() });
});

stopButton.addEventListener("click", () => {
  vscode.postMessage({ type: "stopFile", port: getActivePort() });
});

softResetButton.addEventListener("click", () => {
  vscode.postMessage({ type: "softReset", port: getActivePort() });
});

runSelectionButton.addEventListener("click", () => {
  vscode.postMessage({ type: "runSelection", port: getActivePort() });
});
