import { getActivePort } from "../tabs.js";
import { vscode } from "../vscode.js";

/**
 * Provides the board files tree.
 */
export class BoardFilesProvider {
  constructor() {
    this.id = "boardfiles";
    this.emptyMessage = "loading boardfiles...";
    /** @type {Map<string, FileNode[]>} */
    this._cache = new Map();
  }

  /**
   * Request the board file tree from the extension host.
   * @returns {Promise<FileNode[]>}
   */
  requestNodes() {
    const port = getActivePort();
    vscode.postMessage({ type: "getBoardFiles", port });
  }

  /**
   * Which action buttons to show per node.
   */
  getActions(node, boardActionsDisabled) {
    if (boardActionsDisabled) {
      return [];
    }
    if (node.root) {
      return ["newFile", "newFolder", "refresh"];
    }
    if (node.type === "folder") {
      return ["newFile", "newFolder", "rename", "delete"];
    }
    return ["run", "download", "rename", "delete"];
  }

  /**
   * Requests to open file in editor.
   */
  onClick(node) {
    vscode.postMessage({
      type: "bf_openFile",
      path: node.id,
      port: getActivePort(),
    });
  }

  /**
   * Requests to download local copy of file and open in editor.
   */
  onDoubleClick(node) {
    vscode.postMessage({
      type: "bf_openFilePinned",
      path: node.id,
      port: getActivePort(),
    });
  }

  /**
   * Requests to delete board file or folder.
   */
  deleteNode(node) {
    vscode.postMessage({
      type: "bf_delete",
      path: node.id,
      isFolder: node.type === "folder",
      port: getActivePort(),
    });
  }

  /**
   * Requests to rename board file or folder.
   */
  renameNode(node) {
    vscode.postMessage({
      type: "bf_rename",
      path: node.id,
      isFolder: node.type === "folder",
      port: getActivePort(),
    });
  }

  /**
   * Requests to create a new file on the board.
   */
  createFile(folderNode) {
    vscode.postMessage({
      type: "bf_createFile",
      folderPath: folderNode.id,
      port: getActivePort(),
    });
  }

  /**
   * Requests to create a new folder on the board.
   */
  createFolder(folderNode) {
    vscode.postMessage({
      type: "bf_createFolder",
      folderPath: folderNode.id,
      port: getActivePort(),
    });
  }

  /**
   * Requests to download board file.
   */
  downloadNode(node) {
    vscode.postMessage({
      type: "bf_downloadFile",
      path: node.id,
      port: getActivePort(),
    });
  }

  /**
   * Requests to run board file.
   */
  runNode(node) {
    vscode.postMessage({
      type: "bf_runFile",
      path: node.id,
      port: getActivePort(),
    });
  }

  /**
   * Requests to move board file or folder to target folder.
   */
  move(node, target) {
    vscode.postMessage({
      type: "bf_move",
      port: getActivePort(),
      nodePath: node.id,
      targetPath: target.id,
    });
  }
}
