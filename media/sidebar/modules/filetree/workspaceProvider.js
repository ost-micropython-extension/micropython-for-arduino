import { getActivePort } from "../tabs.js";
import { vscode } from "../vscode.js";

/**
 * Provides the local VS Code workspace file tree.
 */
export class WorkspaceProvider {
  constructor() {
    this.id = "workspace";
    this.emptyMessage = "No workspace folder open.";
  }

  /**
   * Request the workspace file tree.
   */
  requestNodes() {
    vscode.postMessage({ type: "getWorkspaceFiles" });
  }

  /**
   * Returns available inline actions for node.
   */
  getActions(node, boardActionsDisabled) {
    if (node.root) {
      return ["newFile", "newFolder", "refresh"];
    }
    if (node.type === "folder") {
      return ["newFile", "newFolder", "rename", "delete"];
    }
    return boardActionsDisabled
      ? ["rename", "delete"]
      : ["upload", "rename", "delete"];
  }

  /**
   * Requests to open the file in the editor.
   */
  onClick(node) {
    vscode.postMessage({ type: "ws_openFile", path: node.id });
  }

  /**
   * Requests to open a file persistently in the editor.
   */
  onDoubleClick(node) {
    vscode.postMessage({ type: "ws_openFilePinned", path: node.id });
  }

  /**
   * Requests to delete the file or folder.
   */
  deleteNode(node) {
    vscode.postMessage({ type: "ws_delete", path: node.id });
  }

  /**
   * Requests to rename the file or folder.
   */
  renameNode(node) {
    vscode.postMessage({
      type: "ws_rename",
      path: node.id,
      isFolder: node.type === "folder",
    });
  }

  /**
   * Requests to create a new empty file inside the folder.
   */
  createFile(folderNode) {
    vscode.postMessage({
      type: "ws_createFile",
      folderPath: folderNode.id,
    });
  }

  /**
   * Requests to create a new empty folder inside the folder.
   */
  createFolder(folderNode) {
    vscode.postMessage({
      type: "ws_createFolder",
      folderPath: folderNode.id,
    });
  }

  /**
   * Requests to upload the file to the connected board.
   */
  uploadNode(node) {
    vscode.postMessage({
      type: "ws_uploadFile",
      port: getActivePort(),
      path: node.id,
    });
  }

  /**
   * Requests to move the file or folder to the target folder.
   */
  move(node, target) {
    vscode.postMessage({
      type: "ws_move",
      nodePath: node.id,
      targetPath: target.id,
    });
  }
}
