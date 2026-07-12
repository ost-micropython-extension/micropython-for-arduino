import { vscode } from "./modules/vscode.js";
import {
  updateAvailablePorts,
  getActivePort,
  onTabSwitch,
  onTabClose,
  closeTab,
} from "./modules/tabs.js";
import { FileTree } from "./modules/filetree/genericTree.js";
import { BoardFilesProvider } from "./modules/filetree/boardFilesProvider.js";
import { WorkspaceProvider } from "./modules/filetree/workspaceProvider.js";
import {
  updateInstalledList,
  handleUninstallResult,
  updateLibraries,
  handleInstallResult,
  setBoardBlocked,
} from "./modules/libraries.js";
import "./modules/boardActions.js";
import "./modules/stubs.js";
import "./modules/mount.js";
import { updateStatus, resetStatus } from "./modules/boardState.js";
import { updateCodeSupport } from "./modules/codesupport.js";

const _portStateCache = new Map();
const _boardNodesCache = new Map();
const _librariesCache = new Map();

const workspaceTree = new FileTree(
  document.getElementById("workspace-tree"),
  new WorkspaceProvider(),
  vscode,
);
const boardFilesTree = new FileTree(
  document.getElementById("boardfiles-tree"),
  new BoardFilesProvider(),
  vscode,
);

onTabSwitch((port) => {
  if (!port) {
    resetStatus();
    boardFilesTree.refresh();
    workspaceTree.setBoardActionsDisabled(true);
    boardFilesTree.setBoardActionsDisabled(true);
    setBoardBlocked(false, false);
    vscode.postMessage({ type: "updateCodeSupport", libs: [] });
    return;
  }

  const cached = _portStateCache.get(port);
  if (cached) {
    _applyBoardState(cached);
  } else {
    resetStatus();
  }

  boardFilesTree.setNodes(_boardNodesCache.get(port));
  updateInstalledList(_librariesCache.get(port));
  vscode.postMessage({
    type: "updateCodeSupport",
    libs:
      _librariesCache
        .get(port)
        ?.map((lib) => lib.displayName)
        .filter((name) => name !== undefined) || [],
  });
});

onTabClose((port) => {
  _portStateCache.delete(port);
  _boardNodesCache.delete(port);
  _librariesCache.delete(port);
});

document.addEventListener(
  "contextmenu",
  (e) => {
    e.stopPropagation();
  },
  true,
);

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      workspaceTree.setState(new Map(message.value.expandedWSNodes));
      boardFilesTree.setState(new Map(message.value.expandedBFNodes));
      workspaceTree.refresh();
      updateAvailablePorts(message.value.ports);
      break;

    case "ports":
      updateAvailablePorts(message.value);
      break;

    case "disconnected":
      closeTab(message.port);
      break;

    case "activeFileChanged": {
      const filepath = message.path;
      if (filepath.includes(".board_cache")) {
        const boardPath = filepath.split(".board_cache")[1].replace(/\\/g, "/");
        boardFilesTree.selectById(boardPath);
        workspaceTree.removeSelection();
      } else {
        workspaceTree.selectById(filepath);
        boardFilesTree.removeSelection();
      }
      break;
    }

    case "refreshWorkspace":
      workspaceTree.refresh();
      break;

    case "ws_nodeCreated": {
      const wsNode = message.node;
      workspaceTree.addNode(message.parentId, wsNode);
      if (message.select ?? false) {
        workspaceTree.selectById(wsNode.id);
      }
      break;
    }

    case "ws_nodeDeleted":
      workspaceTree.removeNode(message.nodeId);
      break;

    case "ws_nodeRenamed":
      workspaceTree.updateNode(message.nodeId, {
        id: message.newId,
        name: message.newName,
      });
      workspaceTree.selectById(message.newId);
      break;

    case "refreshBoardFiles":
      if (!message.port || message.port === getActivePort()) {
        boardFilesTree.refresh();
      }
      break;

    case "bf_nodeCreated":
      if (!message.port || message.port === getActivePort()) {
        boardFilesTree.addNode(message.parentId, message.node);
        if (message.select ?? false) {
          workspaceTree.selectById(message.node.id);
        }
      }
      break;

    case "bf_nodeDeleted":
      if (!message.port || message.port === getActivePort()) {
        boardFilesTree.removeNode(message.nodeId);
      }
      break;

    case "bf_nodeRenamed":
      if (!message.port || message.port === getActivePort()) {
        boardFilesTree.updateNode(message.nodeId, {
          id: message.newId,
          name: message.newName,
        });
        boardFilesTree.selectById(message.newId);
      }
      break;

    case "boardFiles":
      if (!message.error) {
        _boardNodesCache.set(message.port, message.nodes);
        boardFilesTree.setNodes(message.nodes);
        vscode.postMessage({
          type: "getInstalledLibraries",
          port: getActivePort(),
        });
      } else {
        _boardNodesCache.set(message.port, []);
        boardFilesTree.showError(message.error);
      }
      break;

    case "workspaceFiles":
      if (!message.error) {
        workspaceTree.setNodes(message.nodes);
      } else {
        workspaceTree.showError(message.error);
      }
      break;

    case "installedLibraries":
      const libs = message.value;
      updateInstalledList(libs);
      _librariesCache.set(message.port, message.value);
      break;

    case "libraries":
      updateLibraries(message.value, message.error);
      break;

    case "installResult":
      handleInstallResult();
      boardFilesTree.refresh();
      break;

    case "uninstallResult":
      handleUninstallResult(message);
      boardFilesTree.refresh();
      break;

    case "codeSupport":
      updateCodeSupport(message.value);
      break;

    case "boardState": {
      const { port, value: boardState } = message;

      _portStateCache.set(port, boardState);

      if (port === getActivePort()) {
        _applyBoardState(boardState);
      }
      break;
    }
  }
});

function _applyBoardState(boardState) {
  updateStatus(boardState);

  const busy =
    boardState.running || boardState.fileOpsActive || boardState.mountActive;

  boardFilesTree.setBoardActionsDisabled(busy);
  workspaceTree.setBoardActionsDisabled(!boardState.connected || busy);
  setBoardBlocked(busy, boardState.mountActive);
}

_applyBoardState({
  connected: false,
  mountActive: false,
  fileOpsActive: false,
  running: false,
  replOpen: false,
});

vscode.postMessage({ type: "initialize" });
