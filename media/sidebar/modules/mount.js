import { vscode } from "./vscode.js";
import { getActivePort } from "./tabs.js";
import { attachTooltip } from "./tooltip.js";

const mountButton = document.getElementById("mount-btn");
const mountInfo = document.getElementById("mount-info");

attachTooltip(
  mountInfo,
  "Mounts a local folder onto the device, allowing live editing and direct access to local files and dependencies without copying them to the board.",
);

mountButton.addEventListener("click", () => {
  vscode.postMessage({ type: "toggleMount", port: getActivePort() });
});
